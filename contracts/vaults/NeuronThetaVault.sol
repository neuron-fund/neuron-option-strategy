// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {DSMath} from "../vendor/DSMath.sol";
import {GnosisAuction} from "../libraries/GnosisAuction.sol";
import {Vault} from "../libraries/Vault.sol";
import {ShareMath} from "../libraries/ShareMath.sol";
import {VaultLifecycle} from "../libraries/VaultLifecycle.sol";
import {NeuronPoolUtils} from "../libraries/NeuronPoolUtils.sol";
import {NeuronVault} from "./NeuronVault.sol";
import {NeuronThetaYearnVaultStorage} from "../storage/NeuronThetaYearnVaultStorage.sol";
import {INeuronCollateralVault} from "../interfaces/INeuronCollateralVault.sol";
import {INeuronPool} from "../interfaces/INeuronPool.sol";
import {NeuronPoolUtils} from "../libraries/NeuronPoolUtils.sol";

import "hardhat/console.sol";

/**
 * UPGRADEABILITY: Since we use the upgradeable proxy pattern, we must observe
 * the inheritance chain closely.
 * Any changes/appends in storage variable needs to happen in NeuronThetaYearnVaultStorage.
 * NeuronThetaYearnVault should not inherit from any other contract aside from NeuronVault, NeuronThetaYearnVaultStorage
 */
contract NeuronThetaVault is NeuronVault, NeuronThetaYearnVaultStorage {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using ShareMath for Vault.DepositReceipt;

    /************************************************
     *  IMMUTABLES & CONSTANTS
     ***********************************************/

    /// @notice oTokenFactory is the factory contract used to spawn otokens. Used to lookup otokens.
    // TODO neuron do not make this immutable
    address public immutable OTOKEN_FACTORY;

    // The minimum duration for an option auction.
    uint256 private constant MIN_AUCTION_DURATION = 5 minutes;

    /************************************************
     *  EVENTS
     ***********************************************/

    event OpenShort(
        address indexed options,
        uint256[] depositCollateralAmounts,
        uint256 depositValue,
        address indexed manager
    );

    event CloseShort(address indexed options, uint256[] withdrawAmounts, address indexed manager);

    event NewOptionStrikeSelected(uint256 strikePrice, uint256 delta);

    event PremiumDiscountSet(uint256 premiumDiscount, uint256 newPremiumDiscount);
    event AuctionDurationSet(uint256 auctionDuration, uint256 newAuctionDuration);

    event InitiateGnosisAuction(
        address indexed auctioningToken,
        address indexed biddingToken,
        uint256 auctionCounter,
        address indexed manager
    );

    /************************************************
     *  CONSTRUCTOR & INITIALIZATION
     ***********************************************/

    /**
     * @notice Initializes the contract with immutable variables
     * @param _weth is the Wrapped Ether contract
     * @param _usdc is the USDC contract
     * @param _oTokenFactory is the contract address for minting new opyn option types (strikes, asset, expiry)
     * @param _gammaController is the contract address for opyn actions
     * @param _marginPool is the contract address for providing collateral to opyn
     * @param _gnosisEasyAuction is the contract address that facilitates gnosis auctions
     */
    constructor(
        address _weth,
        address _usdc,
        address _oTokenFactory,
        address _gammaController,
        address _marginPool,
        address _gnosisEasyAuction,
        address _dexRouter,
        address _dexFactory
    ) NeuronVault(_weth, _usdc, _gammaController, _marginPool, _gnosisEasyAuction, _dexRouter, _dexFactory) {
        require(_oTokenFactory != address(0), "!_oTokenFactory");
        OTOKEN_FACTORY = _oTokenFactory;
    }

    /**
     * @notice Initializes the OptionVault contract with storage variables.
     * @param _owner is the owner of the vault with critical permissions
     * @param _keeper is the keeper of the vault with medium permissions (weekly actions)
     * @param _feeRecipient is the address to recieve vault performance and management fees
     * @param _managementFee is the management fee pct.
     * @param _performanceFee is the perfomance fee pct.
     * @param _tokenName is the name of the token
     * @param _tokenSymbol is the symbol of the token
     * @param _optionsPremiumPricer is the address of the contract with the
       black-scholes premium calculation logic
     * @param _strikeSelection is the address of the contract with strike selection logic
     * @param _premiumDiscount is the vault's discount applied to the premium
     * @param _auctionParams is the struct with auction data
     * @param _vaultParams is the struct with vault general data
     */
    function initialize(
        address _owner,
        address _keeper,
        address _feeRecipient,
        uint256 _managementFee,
        uint256 _performanceFee,
        string memory _tokenName,
        string memory _tokenSymbol,
        address _optionsPremiumPricer,
        address _strikeSelection,
        uint32 _premiumDiscount,
        Vault.AuctionParams calldata _auctionParams,
        Vault.VaultParams calldata _vaultParams
    ) external initializer {
        baseInitialize(
            _owner,
            _keeper,
            _feeRecipient,
            _managementFee,
            _performanceFee,
            _tokenName,
            _tokenSymbol,
            _vaultParams
        );
        require(_optionsPremiumPricer != address(0), "!_optionsPremiumPricer");
        require(_strikeSelection != address(0), "!_strikeSelection");
        require(
            _premiumDiscount > 0 && _premiumDiscount < 100 * Vault.PREMIUM_DISCOUNT_MULTIPLIER,
            "!_premiumDiscount"
        );
        require(_auctionParams.auctionDuration >= MIN_AUCTION_DURATION, "!_auctionDuration");
        optionsPremiumPricer = _optionsPremiumPricer;
        strikeSelection = _strikeSelection;
        premiumDiscount = _premiumDiscount;
        auctionDuration = _auctionParams.auctionDuration;
        auctionBiddingToken = _auctionParams.auctionBiddingToken != address(0)
            ? _auctionParams.auctionBiddingToken
            : _vaultParams.asset;
        auctionPremiumSwapPath = _auctionParams.auctionPremiumSwapPath;
    }

    /************************************************
     *  SETTERS
     ***********************************************/

    /**
     * @notice Sets the new discount on premiums for options we are selling
     * @param newPremiumDiscount is the premium discount
     */
    function setPremiumDiscount(uint256 newPremiumDiscount) external onlyOwner {
        require(
            newPremiumDiscount > 0 && newPremiumDiscount < 100 * Vault.PREMIUM_DISCOUNT_MULTIPLIER,
            "Invalid discount"
        );
        emit PremiumDiscountSet(premiumDiscount, newPremiumDiscount);

        premiumDiscount = newPremiumDiscount;
    }

    /**
     * @notice Sets the new auction duration
     * @param newAuctionDuration is the auction duration
     */
    function setAuctionDuration(uint256 newAuctionDuration) external onlyOwner {
        require(newAuctionDuration >= MIN_AUCTION_DURATION, "Invalid auction duration");
        emit AuctionDurationSet(auctionDuration, newAuctionDuration);

        auctionDuration = newAuctionDuration;
    }

    /**
     * @notice Sets a new path for swaps
     * @param newSwapPath is the new path
     */
    function setAuctionPremiumSwapPath(bytes calldata newSwapPath) external onlyOwner nonReentrant {
        require(_checkPath(newSwapPath), "Invalid swapPath");
        console.log("BEFORE SWAP PATH");
        auctionPremiumSwapPath = newSwapPath;
    }

    /**
     * @notice Sets the new strike selection contract
     * @param newStrikeSelection is the address of the new strike selection contract
     */
    function setStrikeSelection(address newStrikeSelection) external onlyOwner {
        require(newStrikeSelection != address(0), "!newStrikeSelection");
        strikeSelection = newStrikeSelection;
    }

    /**
     * @notice Sets the new options premium pricer contract
     * @param newOptionsPremiumPricer is the address of the new strike selection contract
     */
    function setOptionsPremiumPricer(address newOptionsPremiumPricer) external onlyOwner {
        require(newOptionsPremiumPricer != address(0), "!newOptionsPremiumPricer");
        optionsPremiumPricer = newOptionsPremiumPricer;
    }

    /**
     * @notice Optionality to set strike price manually
     * @param strikePrice is the strike price of the new oTokens (decimals = 8)
     */
    function setStrikePrice(uint128 strikePrice) external onlyOwner nonReentrant {
        require(strikePrice > 0, "!strikePrice");
        overriddenStrikePrice = strikePrice;
        lastStrikeOverrideRound = vaultState.round;
    }

    /**
     * @notice Sets the next option the vault will be shorting, and closes the existing short.
     *         This allows all the users to withdraw if the next option is malicious.
     */
    function commitAndClose() external nonReentrant {
        address oldOption = optionState.currentOption;

        VaultLifecycle.CloseParams memory closeParams =
            VaultLifecycle.CloseParams({
                OTOKEN_FACTORY: OTOKEN_FACTORY,
                USDC: USDC,
                currentOption: oldOption,
                delay: DELAY,
                lastStrikeOverrideRound: lastStrikeOverrideRound,
                overriddenStrikePrice: overriddenStrikePrice
            });

        (address otokenAddress, uint256 premium, uint256 strikePrice, uint256 delta) =
            VaultLifecycle.commitAndClose(
                strikeSelection,
                optionsPremiumPricer,
                premiumDiscount,
                closeParams,
                vaultParams,
                vaultState
            );

        emit NewOptionStrikeSelected(strikePrice, delta);
        ShareMath.assertUint104(premium);

        currentOtokenPremium = uint104(premium);
        optionState.nextOption = otokenAddress;

        uint256 nextOptionReady = block.timestamp.add(DELAY);
        require(nextOptionReady <= type(uint32).max, "Overflow nextOptionReady");
        optionState.nextOptionReadyAt = uint32(nextOptionReady);

        _closeShort(oldOption);

        address asset = vaultParams.asset;
        address auctionBiddingToken = auctionBiddingToken;

        // Swap auction premium to asset if premium is different from asset
        // TODO neuron test this case
        if (asset != auctionBiddingToken) {
            VaultLifecycle.swap(auctionBiddingToken, 0, DEX_ROUTER, auctionPremiumSwapPath);
        }

        // Premium
        uint256 assetBalance = IERC20(asset).balanceOf(address(this));
        console.log("commitAndClose ~ asset", asset);
        uint256 roundLockedAmount = vaultState.lastLockedAmount;
        uint256 currentRound = vaultState.round;
        address[] memory collateralVaults = vaultParams.collateralVaults;
        address[] memory collateralAssets = vaultParams.collateralAssets;

        for (uint256 i = 0; i < collateralVaults.length; i++) {
            // Share of collateral vault is calculated as:
            // (premium) * collateralVaultProvidedValue / totalLockedValueForRound
            // TODO neuron check this calculation does not have rounding errors
            uint256 collateralVaultPremiumShare =
                roundLockedAmount == 0
                    ? 0
                    : (assetBalance * roundCollateralsValues[currentRound][i]) / roundLockedAmount;

            console.log("commitAndClose ~ assetBalance", assetBalance);
            console.log(
                "commitAndClose ~ roundCollateralsValues[currentRound][i]",
                roundLockedAmount == 0 ? 0 : roundCollateralsValues[currentRound][i]
            );
            console.log("commitAndClose ~ roundLockedAmount", roundLockedAmount);
            console.log("commitAndClose ~ collateralVaultPremiumShare", collateralVaultPremiumShare);
            uint256 collateralAssetBalance = IERC20(collateralAssets[i]).balanceOf(address(this));
            console.log("commitAndClose ~ collateralAssetBalance", collateralAssetBalance);
            console.log(
                "commitAndClose ~  IERC20(asset).balanceOf(collateralVaults[i])",
                IERC20(asset).balanceOf(collateralVaults[i])
            );
            NeuronPoolUtils.transferAsset(WETH, asset, collateralVaults[i], collateralVaultPremiumShare);
            NeuronPoolUtils.transferAsset(WETH, collateralAssets[i], collateralVaults[i], collateralAssetBalance);
            console.log(
                "commitAndClose ~  IERC20(asset).balanceOf(collateralVaults[i])",
                IERC20(asset).balanceOf(collateralVaults[i])
            );
            INeuronCollateralVault(collateralVaults[i]).commitAndClose();
            console.log(
                "commitAndClose ~  IERC20(asset).balanceOf(collateralVaults[i])",
                IERC20(asset).balanceOf(collateralVaults[i])
            );
        }
    }

    /**
     * @notice Closes the existing short position for the vault.
     */
    function _closeShort(address oldOption) private {
        uint256 lockedAmount = vaultState.lockedAmount;
        if (oldOption != address(0) && vaultState.lastLockedAmount == 0) {
            vaultState.lastLockedAmount = uint104(lockedAmount);
        }
        vaultState.lockedAmount = 0;

        optionState.currentOption = address(0);

        if (oldOption != address(0)) {
            uint256[] memory withdrawnAmounts = VaultLifecycle.settleShort(vaultParams, GAMMA_CONTROLLER);
            emit CloseShort(oldOption, withdrawnAmounts, msg.sender);
        }
    }

    /**
     * @notice Rolls the vault's funds into a new short position.
     */
    function rollToNextOption() external onlyKeeper nonReentrant {
        (address newOption, uint256[] memory lockedCollateralAmounts, uint256 lockedAmountValue) = _rollToNextOption();
        console.log("lockedAmountValue", lockedAmountValue);
        emit OpenShort(newOption, lockedCollateralAmounts, lockedAmountValue, msg.sender);
        VaultLifecycle.createShort(GAMMA_CONTROLLER, MARGIN_POOL, newOption, lockedCollateralAmounts);

        _startAuction();
    }

    /**
     * @notice Initiate the gnosis auction.
     */
    function startAuction() external onlyKeeper nonReentrant {
        _startAuction();
    }

    function _startAuction() private {
        GnosisAuction.AuctionDetails memory auctionDetails;

        uint256 currOtokenPremium = currentOtokenPremium;

        require(currOtokenPremium > 0, "!currentOtokenPremium");

        auctionDetails.oTokenAddress = optionState.currentOption;
        auctionDetails.gnosisEasyAuction = GNOSIS_EASY_AUCTION;
        auctionDetails.asset = vaultParams.asset;
        auctionDetails.assetDecimals = vaultParams.decimals;
        auctionDetails.oTokenPremium = currOtokenPremium;
        auctionDetails.duration = auctionDuration;

        optionAuctionID = VaultLifecycle.startAuction(auctionDetails);
    }

    function getCollateralAssets() external view returns (address[] memory) {
        return vaultParams.collateralAssets;
    }

    /**
     * @notice Burn the remaining oTokens left over from gnosis auction.
     */
    function burnRemainingOTokens() external onlyKeeper nonReentrant {
        uint256[] memory unlockedCollateralAssetsAmounts =
            VaultLifecycle.burnOtokens(vaultParams, GAMMA_CONTROLLER, optionState.currentOption);
        address[] memory collateralVaults = vaultParams.collateralVaults;
        address[] memory collateralAssets = vaultParams.collateralAssets;
        uint256 unlockedAssetAmount;
        for (uint256 i = 0; i < collateralVaults.length; i++) {
            INeuronPool collateral = INeuronPool(collateralAssets[i]);
            uint256 amountInAsset =
                DSMath.wdiv(
                    unlockedCollateralAssetsAmounts[i],
                    collateral.pricePerShare().mul(NeuronPoolUtils.decimalShift(collateralAssets[i]))
                );
            unlockedAssetAmount = unlockedAssetAmount.add(amountInAsset);
            NeuronPoolUtils.transferAsset(
                WETH,
                collateralAssets[i],
                collateralVaults[i],
                unlockedCollateralAssetsAmounts[i]
            );
        }
        if (unlockedAssetAmount != 0) {
            uint104 lockedAmount = vaultState.lockedAmount;
            vaultState.lastLockedAmount = lockedAmount;
            vaultState.lockedAmount = lockedAmount - uint104(unlockedAssetAmount);
        }
    }
}
