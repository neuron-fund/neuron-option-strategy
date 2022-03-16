// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vault} from "./Vault.sol";
import {ShareMath} from "./ShareMath.sol";
import {IStrikeSelection} from "../interfaces/INeuron.sol";
import {GnosisAuction} from "./GnosisAuction.sol";
import {IOtokenFactory, IOtoken, IController, Actions, GammaTypes, MarginVault} from "../interfaces/GammaInterface.sol";
import {IERC20Detailed} from "../interfaces/IERC20Detailed.sol";
import {IGnosisAuction} from "../interfaces/IGnosisAuction.sol";
import {SupportsNonCompliantERC20} from "./SupportsNonCompliantERC20.sol";
import {UniswapRouter} from "./UniswapRouter.sol";

import "hardhat/console.sol";

library VaultLifecycle {
    using SafeMath for uint256;
    using SupportsNonCompliantERC20 for IERC20;

    struct CloseParams {
        address OTOKEN_FACTORY;
        address USDC;
        address currentOption;
        uint256 delay;
        uint16 lastStrikeOverrideRound;
        uint256 overriddenStrikePrice;
    }

    /**
     * @notice Sets the next option the vault will be shorting, and calculates its premium for the auction
     * @param strikeSelection is the address of the contract with strike selection logic
     * @param optionsPremiumPricer is the address of the contract with the
       black-scholes premium calculation logic
     * @param premiumDiscount is the vault's discount applied to the premium
     * @param closeParams is the struct with details on previous option and strike selection details
     * @param vaultParams is the struct with vault general data
     * @param vaultState is the struct with vault accounting state
     * @return otokenAddress is the address of the new option
     * @return premium is the premium of the new option
     * @return strikePrice is the strike price of the new option
     * @return delta is the delta of the new option
     */
    function commitAndClose(
        address strikeSelection,
        address optionsPremiumPricer,
        uint256 premiumDiscount,
        CloseParams calldata closeParams,
        Vault.VaultParams storage vaultParams,
        Vault.VaultState storage vaultState
    )
        external
        returns (
            address otokenAddress,
            uint256 premium,
            uint256 strikePrice,
            uint256 delta
        )
    {
        console.log("expiry");
        uint256 expiry = getNextExpiry(closeParams.currentOption);

        console.log("IStrikeSelection selection");
        IStrikeSelection selection = IStrikeSelection(strikeSelection);

        bool isPut = vaultParams.isPut;
        address underlying = vaultParams.underlying;
        address[] memory collateralAssets = vaultParams.collateralAssets;

        console.log("(strikePrice, delta) = ");
        (strikePrice, delta) = closeParams.lastStrikeOverrideRound == vaultState.round
            ? (closeParams.overriddenStrikePrice, selection.delta())
            : selection.getStrikePrice(expiry, isPut);

        console.log("strikePrice != 0");
        require(strikePrice != 0, "!strikePrice");

        console.log("otokenAddress = ");
        // retrieve address if option already exists, or deploy it
        otokenAddress = getOrDeployOtoken(
            closeParams,
            vaultParams,
            underlying,
            collateralAssets,
            strikePrice,
            expiry,
            isPut
        );

        console.log("premium = ");
        // get the black scholes premium of the option
        premium = GnosisAuction.getOTokenPremium(otokenAddress, optionsPremiumPricer, premiumDiscount);
        console.log("require(premium > 0, !premium);");
        require(premium > 0, "!premium");

        console.log("(otokenAddress, premium, strikePrice, delta);");
        return (otokenAddress, premium, strikePrice, delta);
    }

    /**
     * @notice Verify the otoken has the correct parameters to prevent vulnerability to opyn contract changes
     * @param otokenAddress is the address of the otoken
     * @param vaultParams is the struct with vault general data
     * @param collateralAssets is the address of the collateral asset
     * @param USDC is the address of usdc
     * @param delay is the delay between commitAndClose and rollToNextOption
     */
    function verifyOtoken(
        address otokenAddress,
        Vault.VaultParams storage vaultParams,
        address[] memory collateralAssets,
        address USDC,
        uint256 delay
    ) private view {
        require(otokenAddress != address(0), "!otokenAddress");

        IOtoken otoken = IOtoken(otokenAddress);
        require(otoken.isPut() == vaultParams.isPut, "Type mismatch");
        require(otoken.underlyingAsset() == vaultParams.underlying, "Wrong underlyingAsset");
        require(
            keccak256(abi.encode(otoken.getCollateralAssets())) == keccak256(abi.encode(collateralAssets)),
            "Wrong collateralAsset"
        );

        // we just assume all options use USDC as the strike
        require(otoken.strikeAsset() == USDC, "strikeAsset != USDC");

        uint256 readyAt = block.timestamp.add(delay);
        require(otoken.expiryTimestamp() >= readyAt, "Expiry before delay");
    }

    /**
     * @param currentShareSupply is the supply of the shares invoked with totalSupply()
     * @param asset is the address of the vault's asset
     * @param decimals is the decimals of the asset
     * @param lastQueuedWithdrawAmount is the amount queued for withdrawals from last round
     * @param performanceFee is the perf fee percent to charge on premiums
     * @param managementFee is the management fee percent to charge on the AUM
     */
    struct RolloverParams {
        uint256 decimals;
        uint256 totalBalance;
        uint256 currentShareSupply;
        uint256 lastQueuedWithdrawAmount;
        uint256 performanceFee;
        uint256 managementFee;
    }

    /**
     * @notice Creates the actual Opyn short position by depositing collateral and minting otokens
     * @param gammaController is the address of the opyn controller contract
     * @param marginPool is the address of the opyn margin contract which holds the collateral
     * @param oTokenAddress is the address of the otoken to mint
     * @param depositAmounts is the amounts of collaterals to deposit
     * @return the otoken mint amount
     */
    function createShort(
        address gammaController,
        address marginPool,
        address oTokenAddress,
        uint256[] memory depositAmounts
    ) external returns (uint256) {
        IController controller = IController(gammaController);
        uint256 newVaultID = (controller.accountVaultCounter(address(this))).add(1);

        // An otoken's collateralAsset is the vault's `asset`
        // So in the context of performing Opyn short operations we call them collateralAsset
        IOtoken oToken = IOtoken(oTokenAddress);
        // TODO whats cheaper to call external getCollateralAssets
        // or provide vaultParams storage argument to fucntion and read from it?
        address[] memory collateralAssets = oToken.getCollateralAssets();

        for (uint256 i = 0; i < collateralAssets.length; i++) {
            // double approve to fix non-compliant ERC20s
            IERC20 collateralToken = IERC20(collateralAssets[i]);
            collateralToken.safeApproveNonCompliant(marginPool, depositAmounts[i]);
        }

        Actions.ActionArgs[] memory actions = new Actions.ActionArgs[](3);

        // Pass zero to mint using all deposited collaterals
        uint256[] memory mintAmount = new uint256[](1);

        actions[0] = Actions.ActionArgs(
            uint8(Actions.ActionType.OpenVault),
            address(this), // owner
            oTokenAddress, // optionToken
            new address[](0), // not used
            newVaultID, // vaultId
            new uint256[](0), // not used
            "" // not used
        );

        actions[1] = Actions.ActionArgs(
            uint8(Actions.ActionType.DepositCollateral),
            address(this), // owner
            address(this), // address to transfer from
            new address[](0), // not used
            newVaultID, // vaultId
            depositAmounts, // amounts
            "" //data
        );

        actions[2] = Actions.ActionArgs(
            uint8(Actions.ActionType.MintShortOption),
            address(this), // owner
            address(this), // address to transfer to
            new address[](0), // not used
            newVaultID, // vaultId
            mintAmount, // amount
            "" //data
        );
        console.log("controller", address(controller));
        controller.operate(actions);

        uint256 mintedAmount = oToken.balanceOf(address(this));

        return mintedAmount;
    }

    /**
     * @notice Close the existing short otoken position. Currently this implementation is simple.
     * It closes the most recent vault opened by the contract. This assumes that the contract will
     * only have a single vault open at any given time. Since calling `_closeShort` deletes vaults by
     calling SettleVault action, this assumption should hold.
     * @param gammaController is the address of the opyn controller contract
     * @return amount of collateral redeemed from the vault
     */
    function settleShort(address gammaController) external returns (uint256) {
        IController controller = IController(gammaController);

        // gets the currently active vault ID
        uint256 vaultID = controller.accountVaultCounter(address(this));

        MarginVault.Vault memory vault = controller.getVault(address(this), vaultID);

        require(vault.shortOtoken != address(0), "No short");

        // An otoken's collateralAsset is the vault's `asset`
        // So in the context of performing Opyn short operations we call them collateralAsset
        IERC20 collateralToken = IERC20(vault.collateralAssets[0]);

        // The short position has been previously closed, or all the otokens have been burned.
        // So we return early.
        if (address(collateralToken) == address(0)) {
            return 0;
        }

        // This is equivalent to doing IERC20(vault.asset).balanceOf(address(this))
        uint256 startCollateralBalance = collateralToken.balanceOf(address(this));

        // If it is after expiry, we need to settle the short position using the normal way
        // Delete the vault and withdraw all remaining collateral from the vault
        Actions.ActionArgs[] memory actions = new Actions.ActionArgs[](1);

        actions[0] = Actions.ActionArgs(
            uint8(uint8(Actions.ActionType.SettleVault)),
            address(this), // owner
            address(this), // address to transfer to
            new address[](0), // not used
            vaultID, // vaultId
            new uint256[](0), // not used
            "" // not used
        );

        controller.operate(actions);

        uint256 endCollateralBalance = collateralToken.balanceOf(address(this));

        return endCollateralBalance.sub(startCollateralBalance);
    }

    /**
     * @notice Exercises the ITM option using existing long otoken position. Currently this implementation is simple.
     * It calls the `Redeem` action to claim the payout.
     * @param gammaController is the address of the opyn controller contract
     * @param oldOption is the address of the old option
     * @param asset is the address of the vault's asset
     * @return amount of asset received by exercising the option
     */
    function settleLong(
        address gammaController,
        address oldOption,
        address asset
    ) external returns (uint256) {
        // IController controller = IController(gammaController);

        // uint256 oldOptionBalance = IERC20(oldOption).balanceOf(address(this));

        // if (controller.getPayout(oldOption, oldOptionBalance) == 0) {
        //     return 0;
        // }

        // uint256 startAssetBalance = IERC20(asset).balanceOf(address(this));

        // // If it is after expiry, we need to redeem the profits
        // Actions.ActionArgs[] memory actions = new Actions.ActionArgs[](1);

        // actions[0] = Actions.ActionArgs(
        //     uint8(Actions.ActionType.Redeem),
        //     address(0), // not used
        //     address(this), // address to send profits to
        //     oldOption, // address of otoken
        //     0, // not used
        //     oldOptionBalance, // otoken balance
        //     0, // not used
        //     "" // not used
        // );

        // controller.operate(actions);

        // uint256 endAssetBalance = IERC20(asset).balanceOf(address(this));

        // return endAssetBalance.sub(startAssetBalance);
        return 0;
    }

    /**
     * @notice Burn the remaining oTokens left over from auction. Currently this implementation is simple.
     * It burns oTokens from the most recent vault opened by the contract. This assumes that the contract will
     * only have a single vault open at any given time.
     * @param gammaController is the address of the opyn controller contract
     * @param currentOption is the address of the current option
     * @return amount of collateral redeemed by burning otokens
     */
    function burnOtokens(
        Vault.VaultParams storage vaultParams,
        address gammaController,
        address currentOption
    ) external returns (uint256[] memory) {
        uint256 numOTokensToBurn = IERC20(currentOption).balanceOf(address(this));

        require(numOTokensToBurn > 0, "No oTokens to burn");

        IController controller = IController(gammaController);

        // gets the currently active vault ID
        uint256 vaultID = controller.accountVaultCounter(address(this));

        MarginVault.Vault memory vault = controller.getVault(address(this), vaultID);

        require(vault.shortOtoken != address(0), "No short");

        uint256[] memory startCollateralBalances = getCollateralBalances(vaultParams);

        // Burning `amount` of oTokens from the neuron vault,
        // then withdrawing the corresponding collateral amount from the vault
        Actions.ActionArgs[] memory actions = new Actions.ActionArgs[](2);

        // TODO use array initialization like these everywhere
        address[] memory shortOtokenAddressActionArg;
        shortOtokenAddressActionArg[0] = vault.shortOtoken;

        uint256[] memory burnAmountActionArg;
        burnAmountActionArg[0] = numOTokensToBurn;

        actions[0] = Actions.ActionArgs({
            actionType: uint8(Actions.ActionType.BurnShortOption),
            owner: address(this), // vault owner
            secondAddress: address(0), // not used
            assets: shortOtokenAddressActionArg, // short to burn
            vaultId: vaultID,
            amounts: burnAmountActionArg, // burn amount
            data: ""
        });

        actions[1] = Actions.ActionArgs({
            actionType: uint8(Actions.ActionType.WithdrawCollateral),
            owner: address(this), // vault owner
            secondAddress: address(this), // withdraw to
            assets: new address[](0), // not used
            vaultId: vaultID,
            amounts: new uint256[](1), // array with one zero element to withdraw all available
            data: ""
        });

        controller.operate(actions);

        uint256[] memory endCollateralBalances = getCollateralBalances(vaultParams);

        return getArrayOfDiffs(startCollateralBalances, endCollateralBalances);
    }

    function getCollateralBalances(Vault.VaultParams storage vaultParams) internal view returns (uint256[] memory) {
        address[] memory collateralAssets = vaultParams.collateralAssets;
        uint256 collateralsLength = collateralAssets.length;
        uint256[] memory collateralBalances = new uint256[](collateralsLength);
        for (uint256 i = 0; i < collateralsLength; i++) {
            collateralBalances[i] = IERC20(collateralAssets[i]).balanceOf(address(this));
        }
        return collateralBalances;
    }

    function getArrayOfDiffs(uint256[] memory a, uint256[] memory b) internal pure returns (uint256[] memory) {
        require(a.length == b.length, "Arrays must be of equal length");
        uint256[] memory diffs = new uint256[](a.length);
        for (uint256 i = 0; i < a.length; i++) {
            diffs[i] = a[i].sub(b[i]);
        }
        return diffs;
    }

    /**
     * @notice Either retrieves the option token if it already exists, or deploy it
     * @param closeParams is the struct with details on previous option and strike selection details
     * @param vaultParams is the struct with vault general data
     * @param underlying is the address of the underlying asset of the option
     * @param collateralAssets is the address of the collateral asset of the option
     * @param strikePrice is the strike price of the option
     * @param expiry is the expiry timestamp of the option
     * @param isPut is whether the option is a put
     * @return the address of the option
     */
    function getOrDeployOtoken(
        CloseParams calldata closeParams,
        Vault.VaultParams storage vaultParams,
        address underlying,
        address[] memory collateralAssets,
        uint256 strikePrice,
        uint256 expiry,
        bool isPut
    ) internal returns (address) {
        IOtokenFactory factory = IOtokenFactory(closeParams.OTOKEN_FACTORY);

        address otokenFromFactory =
            factory.getOtoken(underlying, closeParams.USDC, collateralAssets, strikePrice, expiry, isPut);

        if (otokenFromFactory != address(0)) {
            return otokenFromFactory;
        }

        address otoken =
            factory.createOtoken(underlying, closeParams.USDC, collateralAssets, strikePrice, expiry, isPut);

        verifyOtoken(otoken, vaultParams, collateralAssets, closeParams.USDC, closeParams.delay);

        return otoken;
    }

    /**
     * @notice Starts the gnosis auction
     * @param auctionDetails is the struct with all the custom parameters of the auction
     * @return the auction id of the newly created auction
     */
    function startAuction(GnosisAuction.AuctionDetails calldata auctionDetails) external returns (uint256) {
        return GnosisAuction.startAuction(auctionDetails);
    }

    /**
     * @notice Settles the gnosis auction
     * @param gnosisEasyAuction is the contract address of Gnosis easy auction protocol
     * @param auctionID is the auction ID of the gnosis easy auction
     */
    function settleAuction(address gnosisEasyAuction, uint256 auctionID) internal {
        IGnosisAuction(gnosisEasyAuction).settleAuction(auctionID);
    }

    /**
     * @notice Swaps tokens using UniswapV3 router
     * @param tokenIn is the token address to swap
     * @param minAmountOut is the minimum acceptable amount of tokenOut received from swap
     * @param router is the contract address of UniswapV3 router
     * @param swapPath is the swap path e.g. encodePacked(tokenIn, poolFee, tokenOut)
     */
    function swap(
        address tokenIn,
        uint256 minAmountOut,
        address router,
        bytes calldata swapPath
    ) external {
        uint256 balance = IERC20(tokenIn).balanceOf(address(this));

        if (balance > 0) {
            UniswapRouter.swap(address(this), tokenIn, balance, minAmountOut, router, swapPath);
        }
    }

    function checkPath(
        bytes calldata swapPath,
        address validTokenIn,
        address validTokenOut,
        address uniswapFactory
    ) external view returns (bool isValidPath) {
        return UniswapRouter.checkPath(swapPath, validTokenIn, validTokenOut, uniswapFactory);
    }

    /**
     * @notice Verify the constructor params satisfy requirements
     * @param owner is the owner of the vault with critical permissions
     * @param feeRecipient is the address to recieve vault performance and management fees
     * @param performanceFee is the perfomance fee pct.
     * @param tokenName is the name of the token
     * @param tokenSymbol is the symbol of the token
     * @param _vaultParams is the struct with vault general data
     */
    function verifyInitializerParams(
        address owner,
        address keeper,
        address feeRecipient,
        uint256 performanceFee,
        uint256 managementFee,
        string calldata tokenName,
        string calldata tokenSymbol,
        Vault.VaultParams calldata _vaultParams
    ) external pure {
        require(owner != address(0), "!owner");
        require(keeper != address(0), "!keeper");
        require(feeRecipient != address(0), "!feeRecipient");
        require(performanceFee < 100 * Vault.FEE_MULTIPLIER, "performanceFee >= 100%");
        require(managementFee < 100 * Vault.FEE_MULTIPLIER, "managementFee >= 100%");
        require(bytes(tokenName).length > 0, "!tokenName");
        require(bytes(tokenSymbol).length > 0, "!tokenSymbol");

        require(_vaultParams.asset != address(0), "!asset");
        require(_vaultParams.collateralAssets.length != 0, "!collateralAssets");
        require(_vaultParams.underlying != address(0), "!underlying");
    }

    /**
     * @notice Gets the next option expiry timestamp
     * @param currentOption is the otoken address that the vault is currently writing
     */
    function getNextExpiry(address currentOption) internal view returns (uint256) {
        // uninitialized state
        if (currentOption == address(0)) {
            return getNextFriday(block.timestamp);
        }
        uint256 currentExpiry = IOtoken(currentOption).expiryTimestamp();

        // After options expiry if no options are written for >1 week
        // We need to give the ability continue writing options
        if (block.timestamp > currentExpiry + 7 days) {
            return getNextFriday(block.timestamp);
        }
        return getNextFriday(currentExpiry);
    }

    /**
     * @notice Gets the next options expiry timestamp
     * @param timestamp is the expiry timestamp of the current option
     * Reference: https://codereview.stackexchange.com/a/33532
     * Examples:
     * getNextFriday(week 1 thursday) -> week 1 friday
     * getNextFriday(week 1 friday) -> week 2 friday
     * getNextFriday(week 1 saturday) -> week 2 friday
     */
    function getNextFriday(uint256 timestamp) internal pure returns (uint256) {
        // dayOfWeek = 0 (sunday) - 6 (saturday)
        uint256 dayOfWeek = ((timestamp / 1 days) + 4) % 7;
        uint256 nextFriday = timestamp + ((7 + 5 - dayOfWeek) % 7) * 1 days;
        uint256 friday8am = nextFriday - (nextFriday % (24 hours)) + (8 hours);

        // If the passed timestamp is day=Friday hour>8am, we simply increment it by a week to next Friday
        if (timestamp >= friday8am) {
            friday8am += 7 days;
        }
        return friday8am;
    }
}
