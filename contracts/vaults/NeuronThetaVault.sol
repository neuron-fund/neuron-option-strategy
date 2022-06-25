// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {DSMath} from "../vendor/DSMath.sol";
import {GnosisAuction} from "../libraries/GnosisAuction.sol";
import {Vault} from "../libraries/Vault.sol";
import {ShareMath} from "../libraries/ShareMath.sol";
import {VaultLifecycle} from "../libraries/VaultLifecycle.sol";
import {NeuronPoolUtils} from "../libraries/NeuronPoolUtils.sol";
import {NeuronThetaVaultStorage} from "../storage/NeuronThetaVaultStorage.sol";
import {INeuronCollateralVault} from "../interfaces/INeuronCollateralVault.sol";
import {INeuronPool} from "../interfaces/INeuronPool.sol";
import {IController} from "../interfaces/GammaInterface.sol";
import "hardhat/console.sol";

/**
 * UPGRADEABILITY: Since we use the upgradeable proxy pattern, we must observe
 * the inheritance chain closely.
 * Any changes/appends in storage variable needs to happen in NeuronThetaVaultStorage.
 * NeuronThetaYearnVault should not inherit from any other contract aside from NeuronVault, NeuronThetaVaultStorage
 */
contract NeuronThetaVault is ReentrancyGuardUpgradeable, OwnableUpgradeable, NeuronThetaVaultStorage {
    using SafeERC20 for IERC20;
    using ShareMath for Vault.DepositReceipt;

    /************************************************
     *  IMMUTABLES & CONSTANTS
     ***********************************************/

    /// @notice WETH9 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
    address public immutable WETH;

    /// @notice USDC 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
    address public immutable USDC;

    /// @notice 15 minute timelock between commitAndClose and rollToNexOption.
    uint256 public constant DELAY = 0;

    // Number of weeks per year = 52.142857 weeks * FEE_MULTIPLIER = 52142857
    // Dividing by weeks per year requires doing num.mul(FEE_MULTIPLIER).div(WEEKS_PER_YEAR)
    uint256 private constant WEEKS_PER_YEAR = 52142857;

    // GAMMA_CONTROLLER is the top-level contract in Gamma protocol
    // which allows users to perform multiple actions on their vaults
    // and positions https://github.com/opynfinance/GammaProtocol/blob/master/contracts/core/Controller.sol
    address public immutable GAMMA_CONTROLLER;

    // MARGIN_POOL is Gamma protocol's collateral pool.
    // Needed to approve collateral.safeTransferFrom for minting onTokens.
    // https://github.com/opynfinance/GammaProtocol/blob/master/contracts/core/MarginPool.sol
    address public immutable MARGIN_POOL;

    // GNOSIS_EASY_AUCTION is Gnosis protocol's contract for initiating auctions and placing bids
    // https://github.com/gnosis/ido-contracts/blob/main/contracts/EasyAuction.sol
    address public immutable GNOSIS_EASY_AUCTION;

    // DEX_ROUTER is the contract address of UniswapV2 Router which handles swaps
    address public immutable DEX_ROUTER;

    /// @notice onTokenFactory is the factory contract used to spawn onTokens. Used to lookup onTokens.
    address public immutable ON_TOKEN_FACTORY;

    // The minimum duration for an option auction.
    uint256 private constant MIN_AUCTION_DURATION = 5 minutes;

    /************************************************
     *  EVENTS
     ***********************************************/

    event ManagementFeeSet(uint256 managementFee, uint256 newManagementFee);

    event PerformanceFeeSet(uint256 performanceFee, uint256 newPerformanceFee);

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

    event StrikeSelectionSet(address indexed strikeSelection, address indexed newStrikeSelection);

    event OptionsPremiumPricerSet(address indexed optionsPremiumPricer, address indexed newOptionsPremiumPricer);

    event StrikePriceSet(uint16 indexed round, uint16 indexed newRound, uint256 strikePrice, uint256 newStrikePrice);

    event AuctionStarted(GnosisAuction.AuctionDetails auctionDetails, uint256 indexed optionAuctionID);

    event NewKeeperSet(address indexed keeper, address indexed newKeeper);

    event FeeRecipientSet(address indexed feeRecipient, address indexed newFeeRecipient);

    /************************************************
     *  CONSTRUCTOR & INITIALIZATION
     ***********************************************/

    /**
     * @notice Initializes the contract with immutable variables
     * @param _weth is the Wrapped Ether contract
     * @param _usdc is the USDC contract
     * @param _onTokenFactory is the contract address for minting new opyn option types (strikes, asset, expiry)
     * @param _gammaController is the contract address for opyn actions
     * @param _marginPool is the contract address for providing collateral to opyn
     * @param _gnosisEasyAuction is the contract address that facilitates gnosis auctions
     */
    constructor(
        address _weth,
        address _usdc,
        address _onTokenFactory,
        address _gammaController,
        address _marginPool,
        address _gnosisEasyAuction,
        address _dexRouter
    ) {
        require(_weth != address(0), "!_weth");
        require(_usdc != address(0), "!_usdc");
        require(_gammaController != address(0), "!_gammaController");
        require(_marginPool != address(0), "!_marginPool");
        require(_gnosisEasyAuction != address(0), "!_gnosisEasyAuction");
        require(_dexRouter != address(0), "!_dexRouter");
        require(_onTokenFactory != address(0), "!_onTokenFactory");
        ON_TOKEN_FACTORY = _onTokenFactory;
        WETH = _weth;
        USDC = _usdc;
        GAMMA_CONTROLLER = _gammaController;
        MARGIN_POOL = _marginPool;
        GNOSIS_EASY_AUCTION = _gnosisEasyAuction;
        DEX_ROUTER = _dexRouter;
    }

    /**
     * @notice Initializes the OptionVault contract with storage variables.
     * @param _owner is the owner of the vault with critical permissions
     * @param _keeper is the keeper of the vault with medium permissions (weekly actions)
     * @param _feeRecipient is the address to recieve vault performance and management fees
     * @param _managementFee is the management fee pct.
     * @param _performanceFee is the perfomance fee pct.
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
        address _optionsPremiumPricer,
        address _strikeSelection,
        uint32 _premiumDiscount,
        Vault.AuctionParams calldata _auctionParams,
        Vault.VaultParams calldata _vaultParams
    ) external initializer {
        VaultLifecycle.verifyInitializerParams(
            _owner,
            _keeper,
            _feeRecipient,
            _performanceFee,
            _managementFee,
            _vaultParams
        );

        __ReentrancyGuard_init();
        __Ownable_init();
        transferOwnership(_owner);

        keeper = _keeper;

        feeRecipient = _feeRecipient;
        performanceFee = _performanceFee;
        managementFee = _managementFee * Vault.FEE_MULTIPLIER / WEEKS_PER_YEAR;
        vaultParams = _vaultParams;
        vaultState.round = 1;

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
        auctionBiddingToken = _auctionParams.auctionBiddingToken;
    }

    /**
     * @dev Throws if called by any account other than the keeper.
     */
    modifier onlyKeeper() {
        require(msg.sender == keeper, "!keeper");
        _;
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
     * @notice Sets the new strike selection contract
     * @param newStrikeSelection is the address of the new strike selection contract
     */
    function setStrikeSelection(address newStrikeSelection) external onlyOwner {
        require(newStrikeSelection != address(0), "!newStrikeSelection");
        emit StrikeSelectionSet(strikeSelection, newStrikeSelection);
        strikeSelection = newStrikeSelection;
    }

    /**
     * @notice Sets the new options premium pricer contract
     * @param newOptionsPremiumPricer is the address of the new strike selection contract
     */
    function setOptionsPremiumPricer(address newOptionsPremiumPricer) external onlyOwner {
        require(newOptionsPremiumPricer != address(0), "!newOptionsPremiumPricer");
        emit OptionsPremiumPricerSet(optionsPremiumPricer, newOptionsPremiumPricer);
        optionsPremiumPricer = newOptionsPremiumPricer;
    }

    /**
     * @notice Optionality to set strike price manually
     * @param strikePrice is the strike price of the new onTokens (decimals = 8)
     */
    function setStrikePrice(uint128 strikePrice) external onlyOwner nonReentrant {
        require(strikePrice > 0, "!strikePrice");
        uint16 round = vaultState.round;
        emit StrikePriceSet(lastStrikeOverrideRound, round, overriddenStrikePrice, strikePrice);
        overriddenStrikePrice = strikePrice;
        lastStrikeOverrideRound = round;
    }

    /**
     * @notice Sets the next option the vault will be shorting, and closes the existing short.
     *         This allows all the users to withdraw if the next option is malicious.
     */
    function commitAndClose() external nonReentrant {
        address oldOption = optionState.currentOption;

        VaultLifecycle.CloseParams memory closeParams = VaultLifecycle.CloseParams({
            ON_TOKEN_FACTORY: ON_TOKEN_FACTORY,
            USDC: USDC,
            currentOption: oldOption,
            delay: DELAY,
            lastStrikeOverrideRound: lastStrikeOverrideRound,
            overriddenStrikePrice: overriddenStrikePrice
        });

        address oracle = IController(GAMMA_CONTROLLER).oracle();
        VaultLifecycle.ClosePremiumParams memory closePremiumParams = VaultLifecycle.ClosePremiumParams(
            oracle,
            strikeSelection,
            optionsPremiumPricer,
            premiumDiscount,
            auctionBiddingToken
        );
        (address onTokenAddress, uint256 premium, uint256 strikePrice, uint256 delta) = VaultLifecycle.commitAndClose(
            USDC,
            vaultState.round,
            vaultParams,
            closeParams,
            closePremiumParams
        );
        emit NewOptionStrikeSelected(strikePrice, delta);
        ShareMath.assertUint104(premium);

        currentONtokenPremium = uint104(premium);
        optionState.nextOption = onTokenAddress;

        uint256 nextOptionReady = block.timestamp + DELAY;
        require(nextOptionReady <= type(uint32).max, "Overflow nextOptionReady");
        optionState.nextOptionReadyAt = uint32(nextOptionReady);

        address auctionBiddingToken = auctionBiddingToken;
        uint256 premiumAmount = IERC20(auctionBiddingToken).balanceOf(address(this));
        console.log("AFTER SWAP");
        _closeShort(oldOption);

        // Premium
        uint256 roundLockedAmount = vaultState.lastLockedAmount;
        uint256 currentRound = vaultState.round;
        address[] memory collateralVaults = vaultParams.collateralVaults;
        address[] memory collateralAssets = vaultParams.collateralAssets;

        for (uint256 i = 0; i < collateralVaults.length; i++) {
            // Share of collateral vault is calculated as:
            // (premium) * collateralVaultProvidedValue / totalLockedValueForRound
            uint256 collateralVaultPremiumShare = roundLockedAmount == 0
                ? 0
                : (premiumAmount * roundCollateralsValues[currentRound][i]) / roundLockedAmount;
            // Unlocked collateral after option expiry
            uint256 collateralAssetBalance = IERC20(collateralAssets[i]).balanceOf(address(this));

            if (collateralVaultPremiumShare != 0) {
                NeuronPoolUtils.transferAsset(
                    WETH,
                    auctionBiddingToken,
                    collateralVaults[i],
                    collateralVaultPremiumShare
                );
                // TODO event how much premium share was transfered for current collateral vault
            }
            if (collateralAssetBalance != 0) {
                NeuronPoolUtils.transferAsset(WETH, collateralAssets[i], collateralVaults[i], collateralAssetBalance);
            }
            INeuronCollateralVault(collateralVaults[i]).commitAndClose(auctionBiddingToken);
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

        uint256 currONtokenPremium = currentONtokenPremium;

        require(currONtokenPremium > 0, "!currentONtokenPremium");

        auctionDetails.onTokenAddress = optionState.currentOption;
        auctionDetails.gnosisEasyAuction = GNOSIS_EASY_AUCTION;
        auctionDetails.asset = auctionBiddingToken;
        auctionDetails.assetDecimals = vaultParams.decimals;
        auctionDetails.onTokenPremium = currONtokenPremium;
        auctionDetails.duration = auctionDuration;

        optionAuctionID = VaultLifecycle.startAuction(auctionDetails);

        emit AuctionStarted(auctionDetails, optionAuctionID);
    }

    function getCollateralAssets() external view returns (address[] memory) {
        return vaultParams.collateralAssets;
    }

    /**
     * @notice Burn the remaining onTokens left over from gnosis auction.
     */
    function burnRemainingONTokens() external onlyKeeper nonReentrant {
        uint256[] memory unlockedCollateralAssetsAmounts = VaultLifecycle.burnONtokens(
            vaultParams,
            GAMMA_CONTROLLER,
            optionState.currentOption
        );
        address[] memory collateralVaults = vaultParams.collateralVaults;
        address[] memory collateralAssets = vaultParams.collateralAssets;
        uint256 unlockedAssetAmount;
        for (uint256 i = 0; i < collateralVaults.length; i++) {
            INeuronPool collateral = INeuronPool(collateralAssets[i]);
            uint256 amountInAsset = DSMath.wdiv(
                unlockedCollateralAssetsAmounts[i],
                collateral.pricePerShare() * NeuronPoolUtils.decimalShift(collateralAssets[i])
            );
            unlockedAssetAmount = unlockedAssetAmount + amountInAsset;
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

    /**
     * @notice Sets the new keeper
     * @param newKeeper is the address of the new keeper
     */
    function setNewKeeper(address newKeeper) external onlyOwner {
        require(newKeeper != address(0), "!newKeeper");
        emit NewKeeperSet(keeper, newKeeper);
        keeper = newKeeper;
    }

    /**
     * @notice Sets the new fee recipient
     * @param newFeeRecipient is the address of the new fee recipient
     */
    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        require(newFeeRecipient != address(0), "!newFeeRecipient");
        require(newFeeRecipient != feeRecipient, "Must be new feeRecipient");
        emit FeeRecipientSet(feeRecipient, newFeeRecipient);
        feeRecipient = newFeeRecipient;
    }

    /**
     * @notice Sets the management fee for the vault
     * @param newManagementFee is the management fee (6 decimals). ex: 2 * 10 ** 6 = 2%
     */
    function setManagementFee(uint256 newManagementFee) external onlyOwner {
        require(newManagementFee < 100 * Vault.FEE_MULTIPLIER, "Invalid management fee");

        // We are dividing annualized management fee by num weeks in a year
        uint256 tmpManagementFee = newManagementFee * Vault.FEE_MULTIPLIER / WEEKS_PER_YEAR;

        emit ManagementFeeSet(managementFee, newManagementFee);

        managementFee = tmpManagementFee;
    }

    /**
     * @notice Sets the performance fee for the vault
     * @param newPerformanceFee is the performance fee (6 decimals). ex: 20 * 10 ** 6 = 20%
     */
    function setPerformanceFee(uint256 newPerformanceFee) external onlyOwner {
        require(newPerformanceFee < 100 * Vault.FEE_MULTIPLIER, "Invalid performance fee");
        emit PerformanceFeeSet(performanceFee, newPerformanceFee);
        performanceFee = newPerformanceFee;
    }

    /*
     * @notice Helper function that performs most administrative tasks
     * such as setting next option, minting new shares, getting vault fees, etc.
     * @param lastQueuedWithdrawAmount is old queued withdraw amount
     * @return newOption is the new option address
     * @return queuedWithdrawAmount is the queued amount for withdrawal
     */
    function _rollToNextOption()
        internal
        returns (
            address,
            uint256[] memory,
            uint256
        )
    {
        require(block.timestamp >= optionState.nextOptionReadyAt, "!ready");

        address newOption = optionState.nextOption;
        require(newOption != address(0), "!nextOption");

        optionState.currentOption = newOption;
        optionState.nextOption = address(0);

        // Finalize the pricePerShare at the end of the round
        uint256 nextRound = vaultState.round + 1;

        vaultState.round = uint16(nextRound);

        address[] memory collateralVaults = vaultParams.collateralVaults;

        // Collaterals amounts denominated in asset
        uint256[] memory lockedCollateralsValues = new uint256[](collateralVaults.length);
        uint256[] memory lockedCollateralsAmounts = new uint256[](collateralVaults.length);
        uint256 totalLockedCollateralValue;
        // Execute rollToNextOption in collateral vaults first to receive collaterals
        for (uint256 i = 0; i < collateralVaults.length; i++) {
            (lockedCollateralsAmounts[i], lockedCollateralsValues[i]) = INeuronCollateralVault(collateralVaults[i])
                .rollToNextOption();
            totalLockedCollateralValue = totalLockedCollateralValue + lockedCollateralsValues[i];
        }

        roundCollateralsValues[nextRound] = lockedCollateralsValues;
        vaultState.lockedAmount = uint104(totalLockedCollateralValue);
        return (newOption, lockedCollateralsAmounts, totalLockedCollateralValue);
    }

    /************************************************
     *  HELPERS
     ***********************************************/

    function getVaultParams() external view returns (Vault.VaultParams memory) {
        return vaultParams;
    }

    function nextOptionReadyAt() external view returns (uint256) {
        return optionState.nextOptionReadyAt;
    }

    function currentOption() external view returns (address) {
        return optionState.currentOption;
    }

    function nextOption() external view returns (address) {
        return optionState.nextOption;
    }
}
