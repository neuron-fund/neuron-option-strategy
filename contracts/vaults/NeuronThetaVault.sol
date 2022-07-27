// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {GnosisAuction} from "../libraries/GnosisAuction.sol";
import {Vault} from "../libraries/Vault.sol";
import {ShareMath} from "../libraries/ShareMath.sol";
import {VaultLifecycle} from "../libraries/VaultLifecycle.sol";
import {NeuronPoolUtils} from "../libraries/NeuronPoolUtils.sol";
import {NeuronThetaVaultStorage} from "../storage/NeuronThetaVaultStorage.sol";
import {INeuronCollateralVault} from "../interfaces/INeuronCollateralVault.sol";
import {INeuronPool} from "../interfaces/INeuronPool.sol";
import {IController, MarginVault} from "../interfaces/GammaInterface.sol";
import {IERC20Detailed} from "../interfaces/IERC20Detailed.sol";

/**
 * UPGRADEABILITY: Since we use the upgradeable proxy pattern, we must observe
 * the inheritance chain closely.
 * Any changes/appends in storage variable needs to happen in NeuronThetaVaultStorage.
 * NeuronThetaYearnVault should not inherit from any other contract aside from NeuronVault, NeuronThetaVaultStorage
 */
contract NeuronThetaVault is ReentrancyGuardUpgradeable, OwnableUpgradeable, NeuronThetaVaultStorage {
    using SafeERC20 for IERC20Detailed;
    using ShareMath for Vault.DepositReceipt;

    /************************************************
     *  IMMUTABLES & CONSTANTS
     ***********************************************/

    /// @notice WETH9 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
    address public immutable WETH;

    /// @notice USDC 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
    address public immutable USDC;

    /// @notice 15 minute timelock between commitAndClose and rollToNexOption.
    uint256 public constant DELAY = 900;

    // Number of weeks per year = 52.142857 weeks * FEE_MULTIPLIER = 52142857
    // Dividing by weeks per year requires doing num.mul(FEE_MULTIPLIER).div(WEEKS_PER_YEAR)
    uint256 private constant WEEKS_PER_YEAR = 52142857;

    // GAMMA_CONTROLLER is the top-level contract in Gamma protocol
    // which allows users to perform multiple actions on their vaults
    address public immutable GAMMA_CONTROLLER;

    // MARGIN_POOL is Gamma protocol's collateral pool.
    // Needed to approve collateral.safeTransferFrom for minting onTokens.
    address public immutable MARGIN_POOL;

    // GNOSIS_EASY_AUCTION is Gnosis protocol's contract for initiating auctions and placing bids
    // https://github.com/gnosis/ido-contracts/blob/main/contracts/EasyAuction.sol
    address public immutable GNOSIS_EASY_AUCTION;

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

    event PremiumDistribute(address indexed collateralVault, uint256 amount);

    /************************************************
     *  CONSTRUCTOR & INITIALIZATION
     ***********************************************/

    /**
     * @notice Initializes the contract with immutable variables
     * @param _weth is the Wrapped Ether contract
     * @param _usdc is the USDC contract
     * @param _onTokenFactory is the contract address for minting new option protocoloption types (strikes, asset, expiry)
     * @param _gammaController is the contract address for option protocolactions
     * @param _marginPool is the contract address for providing collateral to option protocol
     * @param _gnosisEasyAuction is the contract address that facilitates gnosis auctions
     */
    constructor(
        address _weth,
        address _usdc,
        address _onTokenFactory,
        address _gammaController,
        address _marginPool,
        address _gnosisEasyAuction
    ) {
        require(_weth != address(0), "!_weth");
        require(_usdc != address(0), "!_usdc");
        require(_gammaController != address(0), "!_gammaController");
        require(_marginPool != address(0), "!_marginPool");
        require(_gnosisEasyAuction != address(0), "!_gnosisEasyAuction");
        require(_onTokenFactory != address(0), "!_onTokenFactory");
        ON_TOKEN_FACTORY = _onTokenFactory;
        WETH = _weth;
        USDC = _usdc;
        GAMMA_CONTROLLER = _gammaController;
        MARGIN_POOL = _marginPool;
        GNOSIS_EASY_AUCTION = _gnosisEasyAuction;
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
        managementFee = (_managementFee * Vault.FEE_MULTIPLIER) / WEEKS_PER_YEAR;
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
        auctionBiddingTokenDecimals = IERC20Detailed(_auctionParams.auctionBiddingToken).decimals();
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
    function setStrikePrice(uint128 strikePrice) external onlyOwner {
        require(strikePrice > 0, "!strikePrice");
        uint16 round = vaultState.round;
        emit StrikePriceSet(lastStrikeOverrideRound, round, overriddenStrikePrice, strikePrice);
        overriddenStrikePrice = strikePrice;
        lastStrikeOverrideRound = round;
    }

    function queueCollateralUpdate(Vault.CollateralUpdate calldata _collateralUpdate) external onlyOwner {
        require(
            _collateralUpdate.newCollateralVaults.length == _collateralUpdate.newCollateralAssets.length,
            "newCollateralVaults.length != newCollateralAssets.length"
        );

        for (uint256 i = 0; i < _collateralUpdate.newCollateralVaults.length; i++) {
            require(_collateralUpdate.newCollateralVaults[i] != address(0), "!newCollateralVaults[i]");
            require(_collateralUpdate.newCollateralAssets[i] != address(0), "!newCollateralAssets[i]");

            (, , address collateralAssetFromVault, , , ) = INeuronCollateralVault(
                _collateralUpdate.newCollateralVaults[i]
            ).vaultParams();

            require(
                collateralAssetFromVault == _collateralUpdate.newCollateralAssets[i],
                "collateralAssetFromVault != newCollateralAssets[i]"
            );

            require(
                !INeuronCollateralVault(_collateralUpdate.newCollateralVaults[i]).isDisabled(),
                "newCollateralVault is disabled"
            );
        }

        collateralUpdate = _collateralUpdate;
    }

    /**
     * @notice Sets the next option the vault will be shorting, and closes the existing short.
     *         This allows all the users to withdraw if the next option is malicious.
     */
    function commitAndClose() external nonReentrant {
        address oldOption = optionState.currentOption;
        _closeShort(oldOption);

        address[] memory roundCollateralVaults = vaultParams.collateralVaults;
        address[] memory roundCollateralAssets = vaultParams.collateralAssets;
        if (collateralUpdate.newCollateralVaults.length > 0) {
            vaultParams.collateralVaults = collateralUpdate.newCollateralVaults;
            vaultParams.collateralAssets = collateralUpdate.newCollateralAssets;
            collateralUpdate.newCollateralVaults = new address[](0);
            collateralUpdate.newCollateralAssets = new address[](0);
        }

        address oracle = IController(GAMMA_CONTROLLER).oracle();
        (address onTokenAddress, uint256 premium, uint256 strikePrice, uint256 delta) = VaultLifecycle.commitAndClose(
            USDC,
            vaultState.round,
            vaultParams,
            VaultLifecycle.CloseParams({
                ON_TOKEN_FACTORY: ON_TOKEN_FACTORY,
                USDC: USDC,
                currentOption: oldOption,
                delay: DELAY,
                lastStrikeOverrideRound: lastStrikeOverrideRound,
                overriddenStrikePrice: overriddenStrikePrice
            }),
            VaultLifecycle.ClosePremiumParams(
                oracle,
                strikeSelection,
                optionsPremiumPricer,
                premiumDiscount,
                auctionBiddingToken
            )
        );
        emit NewOptionStrikeSelected(strikePrice, delta);
        ShareMath.assertUint104(premium);

        currentONtokenPremium = uint104(premium);
        optionState.nextOption = onTokenAddress;

        uint256 nextOptionReady = block.timestamp + DELAY;
        require(nextOptionReady <= type(uint32).max, "Overflow nextOptionReady");
        optionState.nextOptionReadyAt = uint32(nextOptionReady);

        address auctionBiddingToken = auctionBiddingToken;
        uint256 premiumAmount = IERC20Detailed(auctionBiddingToken).balanceOf(address(this));

        distributePremiums(premiumAmount, roundCollateralVaults, roundCollateralAssets);
    }

    function distributePremiums(
        uint256 premiumAmount,
        address[] memory roundCollateralVaults,
        address[] memory roundCollateralAssets
    ) internal {
        uint256 roundLockedValue = vaultState.lastLockedValue;
        uint256 currentRound = vaultState.round;

        for (uint256 i = 0; i < roundCollateralVaults.length; i++) {
            // Share of collateral vault is calculated as:
            // (premium) * collateralVaultProvidedValue / totalLockedValueForRound
            uint256 collateralVaultPremiumShare = roundLockedValue == 0
                ? 0
                : (premiumAmount * roundCollateralsValues[currentRound][i]) / roundLockedValue;
            // Unlocked collateral after option expiry
            uint256 collateralAssetBalance = IERC20Detailed(roundCollateralAssets[i]).balanceOf(address(this));

            if (collateralVaultPremiumShare != 0) {
                NeuronPoolUtils.transferAsset(
                    WETH,
                    auctionBiddingToken,
                    roundCollateralVaults[i],
                    collateralVaultPremiumShare
                );
            }
            if (collateralAssetBalance != 0) {
                NeuronPoolUtils.transferAsset(
                    WETH,
                    roundCollateralAssets[i],
                    roundCollateralVaults[i],
                    collateralAssetBalance
                );
            }
            INeuronCollateralVault(roundCollateralVaults[i]).commitAndClose(auctionBiddingToken);
            emit PremiumDistribute(roundCollateralVaults[i], collateralVaultPremiumShare);
        }
    }

    /**
     * @notice Closes the existing short position for the vault.
     */
    function _closeShort(address oldOption) private {
        uint256 lockedValue = vaultState.lockedValue;
        if (oldOption != address(0) && vaultState.lastLockedValue == 0) {
            vaultState.lastLockedValue = uint104(lockedValue);
        }
        vaultState.lockedValue = 0;

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
        (address newOption, uint256[] memory lockedCollateralAmounts) = _rollToNextOption();
        (, uint256 newVaultId) = VaultLifecycle.createShort(
            GAMMA_CONTROLLER,
            MARGIN_POOL,
            newOption,
            lockedCollateralAmounts
        );

        (MarginVault.Vault memory newVault, ) = IController(GAMMA_CONTROLLER).getVaultWithDetails(
            address(this),
            newVaultId
        );

        uint256[] memory lockedCollateralsValues = newVault.usedCollateralValues;
        uint256 totalLockedCollateralValue = uint256ArraySum(lockedCollateralsValues);

        roundCollateralsValues[vaultState.round] = lockedCollateralsValues;
        vaultState.lockedValue = uint104(totalLockedCollateralValue);

        emit OpenShort(newOption, lockedCollateralAmounts, totalLockedCollateralValue, msg.sender);

        _startAuction();
    }

    function _startAuction() private {
        GnosisAuction.AuctionDetails memory auctionDetails;

        uint256 currONtokenPremium = currentONtokenPremium;

        require(currONtokenPremium > 0, "!currentONtokenPremium");

        auctionDetails.onTokenAddress = optionState.currentOption;
        auctionDetails.gnosisEasyAuction = GNOSIS_EASY_AUCTION;
        auctionDetails.asset = auctionBiddingToken;
        auctionDetails.assetDecimals = auctionBiddingTokenDecimals;
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
        VaultLifecycle.burnONtokens(GAMMA_CONTROLLER, optionState.currentOption);
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
        uint256 tmpManagementFee = (newManagementFee * Vault.FEE_MULTIPLIER) / WEEKS_PER_YEAR;

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
    function _rollToNextOption() internal returns (address, uint256[] memory) {
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
        uint256[] memory lockedCollateralsAmounts = new uint256[](collateralVaults.length);
        // Execute rollToNextOption in collateral vaults first to receive collaterals
        for (uint256 i = 0; i < collateralVaults.length; i++) {
            (lockedCollateralsAmounts[i]) = INeuronCollateralVault(collateralVaults[i]).rollToNextOption();
        }

        return (newOption, lockedCollateralsAmounts);
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

    /**
     * @notice calculates sum of uint256 array
     * @param _array uint256[] memory
     * @return uint256 sum of all elements in _array
     */
    function uint256ArraySum(uint256[] memory _array) internal pure returns (uint256) {
        uint256 sum = 0;
        for (uint256 i = 0; i < _array.length; i++) {
            sum = sum + _array[i];
        }
        return sum;
    }
}
