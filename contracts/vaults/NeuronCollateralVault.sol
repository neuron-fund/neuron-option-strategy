// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import {DSMath} from "../vendor/DSMath.sol";
import {INeuronPool} from "../interfaces/INeuronPool.sol";
import {INeuronCollateralVault} from "../interfaces/INeuronCollateralVault.sol";
import {Vault} from "../libraries/Vault.sol";
import {CollateralVaultLifecycle} from "../libraries/CollateralVaultLifecycle.sol";
import {NeuronPoolUtils} from "../libraries/NeuronPoolUtils.sol";
import {ShareMath} from "../libraries/ShareMath.sol";
import {NeuronCollateralVaultStorage} from "../storage/NeuronCollateralVaultStorage.sol";

contract NeuronCollateralVault is
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    ERC20Upgradeable,
    NeuronCollateralVaultStorage
{
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using ShareMath for Vault.DepositReceipt;

    /************************************************
     *  EVENTS
     ***********************************************/

    event Deposit(address indexed account, uint256 amount, uint256 round);

    event InitiateWithdraw(address indexed account, uint256 shares, uint256 round);

    event InstantWithdraw(address indexed account, uint256 amount, uint256 round);

    event Redeem(address indexed account, uint256 share, uint256 round);

    event ManagementFeeSet(uint256 managementFee, uint256 newManagementFee);

    event PerformanceFeeSet(uint256 performanceFee, uint256 newPerformanceFee);

    event CapSet(uint256 oldCap, uint256 newCap);

    event Withdraw(address indexed account, uint256 amount, uint256 shares);

    event CollectVaultFees(uint256 performanceFee, uint256 vaultFee, uint256 round, address indexed feeRecipient);

    event OpenShort(uint256 depositAmount, address indexed manager);

    event PremiumSwap(uint256 recievedAmount, uint256 swapResultAmount, uint256 round);

    event NewKeeperSet(address indexed keeper, address indexed newKeeper);

    event RoundInit(uint256 indexed round);

    /************************************************
     *  IMMUTABLES & CONSTANTS
     ***********************************************/

    /// @notice WETH9 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
    address public immutable WETH;

    /// @notice USDC 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
    address public immutable USDC;

    // Number of weeks per year = 52.142857 weeks * FEE_MULTIPLIER = 52142857
    // Dividing by weeks per year requires doing num.mul(FEE_MULTIPLIER).div(WEEKS_PER_YEAR)
    uint256 private constant WEEKS_PER_YEAR = 52142857;

    /// @notice Token address used to identify ETH deposits in NeuronPools
    address public constant NEURON_POOL_ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /************************************************
     *  CONSTRUCTOR & INITIALIZATION
     ***********************************************/

    /**
     * @notice Initializes the contract with immutable variables
     * @param _weth is the Wrapped Ether contract
     * @param _usdc is the USDC contract
     */
    constructor(address _weth, address _usdc) {
        require(_weth != address(0), "!_weth");
        require(_usdc != address(0), "!_usdc");

        WETH = _weth;
        USDC = _usdc;
    }

    /**
     * @notice Initializes the OptionVault contract with storage variables.
     */
    function initialize(
        address _owner,
        address _keeper,
        address _feeRecipient,
        uint256 _managementFee,
        uint256 _performanceFee,
        string calldata _tokenName,
        string calldata _tokenSymbol,
        Vault.CollateralVaultParams calldata _vaultParams,
        address[] calldata _baseDepositTokens
    ) external initializer {
        CollateralVaultLifecycle.verifyInitializerParams(
            _owner,
            _keeper,
            _feeRecipient,
            _performanceFee,
            _managementFee,
            _tokenName,
            _tokenSymbol,
            _vaultParams
        );
        __ReentrancyGuard_init();
        __ERC20_init(_tokenName, _tokenSymbol);
        __Ownable_init();
        transferOwnership(_owner);

        keeper = _keeper;

        feeRecipient = _feeRecipient;
        performanceFee = _performanceFee;
        managementFee = _managementFee.mul(Vault.FEE_MULTIPLIER).div(WEEKS_PER_YEAR);
        vaultParams = _vaultParams;

        collateralToken = INeuronPool(_vaultParams.collateralAsset);

        uint256 collateralAssetBalance = totalBalance();
        ShareMath.assertUint104(collateralAssetBalance);
        vaultState.lastLockedAmount = uint104(collateralAssetBalance);

        for (uint256 i = 0; i < _baseDepositTokens.length; i++) {
            allowedDepositTokens[_baseDepositTokens[i]] = true;
        }
        allowedDepositTokens[_vaultParams.collateralAsset] = true;

        vaultState.round = 1;
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
        feeRecipient = newFeeRecipient;
    }

    /**
     * @notice Sets the management fee for the vault
     * @param newManagementFee is the management fee (6 decimals). ex: 2 * 10 ** 6 = 2%
     */
    function setManagementFee(uint256 newManagementFee) external onlyOwner {
        require(newManagementFee < 100 * Vault.FEE_MULTIPLIER, "Invalid management fee");

        // We are dividing annualized management fee by num weeks in a year
        uint256 tmpManagementFee = newManagementFee.mul(Vault.FEE_MULTIPLIER).div(WEEKS_PER_YEAR);

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

    /**
     * @notice Sets a new cap for deposits
     * @param newCap is the new cap for deposits
     */
    function setCap(uint256 newCap) external onlyOwner {
        require(newCap > 0, "!newCap");
        ShareMath.assertUint104(newCap);
        emit CapSet(vaultParams.cap, newCap);
        vaultParams.cap = uint104(newCap);
    }

    /************************************************
     *  DEPOSIT & WITHDRAWALS
     ***********************************************/

    /**
     * @notice Deposits the `asset` from msg.sender.
     * @param _amount is the amount of `asset` to deposit
     */
    function deposit(uint256 _amount, address _depositToken) external payable nonReentrant {
        require(!vaultState.isDisabled, "vault is disabled");
        require(_amount > 0, "!amount");
        require(allowedDepositTokens[_depositToken], "!_depositToken");

        if (_depositToken == NEURON_POOL_ETH) {
            require(msg.value == _amount, "deposit ETH: msg.value != _amount");
        } else {
            require(msg.value == 0, "deposit non-ETH: msg.value != 0");
        }

        _depositWithToken(_amount, msg.sender, _depositToken);
    }

    /**
     * @notice Deposits the `asset` from msg.sender added to `creditor`'s deposit.
     * @notice Used for vault -> vault deposits on the user's behalf
     * @param _amount is the amount of `asset` to deposit
     * @param _creditor is the address that can claim/withdraw deposited amount
     */
    function depositFor(
        uint256 _amount,
        address _creditor,
        address _depositToken
    ) external payable nonReentrant {
        require(!vaultState.isDisabled, "vault is disabled");
        require(_amount > 0, "!amount");
        require(_creditor != address(0), "!creditor");
        require(allowedDepositTokens[_depositToken], "!_depositToken");

        if (_depositToken == NEURON_POOL_ETH) {
            require(msg.value == _amount, "deposit ETH: msg.value != _amount");
        } else {
            require(msg.value == 0, "deposit non-ETH: msg.value != 0");
        }

        _depositWithToken(_amount, _creditor, _depositToken);
    }

    function _depositWithToken(
        uint256 _amount,
        address _creditor,
        address _depositToken
    ) internal {
        if (_depositToken != NEURON_POOL_ETH) {
            IERC20(_depositToken).safeTransferFrom(msg.sender, address(this), _amount);
        }

        if (_depositToken == vaultParams.collateralAsset) {
            _depositYieldToken(_amount, _creditor);
        } else {
            if (_depositToken != NEURON_POOL_ETH) {
                IERC20(_depositToken).safeApprove(address(collateralToken), _amount);
            }
            uint256 mintedCollateralTokens = collateralToken.deposit{value: _amount}(_depositToken, _amount);
            _depositYieldToken(mintedCollateralTokens, _creditor);
        }
    }

    /**
     * @notice Deposits the `collateralToken` into the contract and mint vault shares.
     * @param amount is the amount of `collateralToken` to deposit
     */
    function _depositYieldToken(uint256 amount, address creditor) internal {
        uint256 amountInAsset = DSMath.wmul(
            amount,
            collateralToken.pricePerShare().mul(NeuronPoolUtils.decimalShift(address(collateralToken)))
        );

        _depositFor(amountInAsset, creditor);
    }

    /**
     * @notice Mints the vault shares to the creditor
     * @param amount is the amount of `asset` deposited
     * @param creditor is the address to receieve the deposit
     */
    function _depositFor(uint256 amount, address creditor) private {
        uint256 currentRound = vaultState.round;
        uint256 totalWithDepositedAmount = totalBalance();
        require(totalWithDepositedAmount <= vaultParams.cap, "Exceed cap");
        require(totalWithDepositedAmount >= vaultParams.minimumSupply, "Insufficient balance");

        emit Deposit(creditor, amount, currentRound);

        Vault.DepositReceipt memory depositReceipt = depositReceipts[creditor];

        // If we have an unprocessed pending deposit from the previous rounds, we have to process it.
        uint256 unredeemedShares = depositReceipt.getSharesFromReceipt(
            currentRound,
            roundPricePerShare[depositReceipt.round],
            vaultParams.decimals
        );

        uint256 depositAmount = amount;
        // If we have a pending deposit in the current round, we add on to the pending deposit
        if (currentRound == depositReceipt.round) {
            uint256 newAmount = uint256(depositReceipt.amount).add(amount);
            depositAmount = newAmount;
        }

        ShareMath.assertUint104(depositAmount);

        depositReceipts[creditor] = Vault.DepositReceipt({
            round: uint16(currentRound),
            amount: uint104(depositAmount),
            unredeemedShares: uint128(unredeemedShares)
        });

        uint256 newTotalPending = uint256(vaultState.totalPending).add(amount);
        ShareMath.assertUint128(newTotalPending);
        vaultState.totalPending = uint128(newTotalPending);
    }

    /**
     * @notice Initiates a withdrawal that can be processed once the round completes
     * @param numShares is the number of shares to withdraw
     */
    function initiateWithdraw(uint256 numShares) external nonReentrant {
        require(numShares > 0, "!numShares");

        // We do a max redeem before initiating a withdrawal
        // But we check if they must first have unredeemed shares
        if (depositReceipts[msg.sender].amount > 0 || depositReceipts[msg.sender].unredeemedShares > 0) {
            _redeem(0, true);
        }

        // This caches the `round` variable used in shareBalances
        uint256 currentRound = vaultState.round;
        Vault.Withdrawal storage withdrawal = withdrawals[msg.sender];

        bool withdrawalIsSameRound = withdrawal.round == currentRound;
        emit InitiateWithdraw(msg.sender, numShares, currentRound);
        uint256 existingShares = uint256(withdrawal.shares);
        uint256 withdrawalShares;
        if (withdrawalIsSameRound) {
            withdrawalShares = existingShares.add(numShares);
        } else {
            require(existingShares == 0, "Existing withdraw");
            withdrawalShares = numShares;
            withdrawals[msg.sender].round = uint16(currentRound);
        }
        ShareMath.assertUint128(withdrawalShares);
        withdrawals[msg.sender].shares = uint128(withdrawalShares);
        uint256 newQueuedWithdrawShares = uint256(vaultState.queuedWithdrawShares).add(numShares);
        ShareMath.assertUint128(newQueuedWithdrawShares);
        vaultState.queuedWithdrawShares = uint128(newQueuedWithdrawShares);
        _transfer(msg.sender, address(this), numShares);
    }

    /**
     * @notice Redeems shares that are owed to the account
     * @param numShares is the number of shares to redeem
     */
    function redeem(uint256 numShares) external nonReentrant {
        require(numShares > 0, "!numShares");
        _redeem(numShares, false);
    }

    /**
     * @notice Redeems the entire unredeemedShares balance that is owed to the account
     */
    function maxRedeem() external nonReentrant {
        _redeem(0, true);
    }

    /**
     * @notice Redeems shares that are owed to the account
     * @param numShares is the number of shares to redeem, could be 0 when isMax=true
     * @param isMax is flag for when callers do a max redemption
     */
    function _redeem(uint256 numShares, bool isMax) internal {
        Vault.DepositReceipt memory depositReceipt = depositReceipts[msg.sender];

        // This handles the null case when depositReceipt.round = 0
        // Because we start with round = 1 at `initialize`
        uint256 currentRound = vaultState.round;

        uint256 unredeemedShares = depositReceipt.getSharesFromReceipt(
            currentRound,
            roundPricePerShare[depositReceipt.round],
            vaultParams.decimals
        );

        numShares = isMax ? unredeemedShares : numShares;
        if (numShares == 0) {
            return;
        }
        require(numShares <= unredeemedShares, "Exceeds available");

        // If we have a depositReceipt on the same round, BUT we have some unredeemed shares
        // we debit from the unredeemedShares, but leave the amount field intact
        // If the round has past, with no new deposits, we just zero it out for new deposits.
        if (depositReceipt.round < currentRound) {
            depositReceipts[msg.sender].amount = 0;
        }

        ShareMath.assertUint128(numShares);

        depositReceipts[msg.sender].unredeemedShares = uint128(unredeemedShares.sub(numShares));

        emit Redeem(msg.sender, numShares, depositReceipt.round);
        _transfer(address(this), msg.sender, numShares);
    }

    /************************************************
     *  VAULT OPERATIONS
     ***********************************************/

    /**
     * @notice Withdraws the assets on the vault using the outstanding `DepositReceipt.amount`
     * @param amount is the amount to withdraw
     */
    function withdrawInstantly(uint256 amount, address _withdrawToken) external nonReentrant {
        require(!vaultState.isDisabled, "vault is disabled, use withdrawIfDisabled");
        require(allowedDepositTokens[_withdrawToken], "!_withdrawToken");

        Vault.DepositReceipt storage depositReceipt = depositReceipts[msg.sender];

        uint256 currentRound = vaultState.round;

        require(amount > 0, "!amount");
        require(depositReceipt.round == currentRound, "Invalid round");

        uint256 receiptAmount = depositReceipt.amount;
        require(receiptAmount >= amount, "Exceed amount");

        // Subtraction underflow checks already ensure it is smaller than uint104
        depositReceipt.amount = uint104(receiptAmount.sub(amount));
        vaultState.totalPending = uint128(uint256(vaultState.totalPending).sub(amount));

        emit InstantWithdraw(msg.sender, amount, currentRound);

        _transferAsset(_withdrawToken, amount);
    }

    function _transferAsset(address _withdrawToken, uint256 _amount) internal returns (uint256) {
        address collateralTokenAddress = address(collateralToken);
        if (_withdrawToken != collateralTokenAddress) {
            _amount = NeuronPoolUtils.unwrapNeuronPool(_amount, _withdrawToken, collateralTokenAddress);
        }
        NeuronPoolUtils.transferAsset(WETH, _withdrawToken, msg.sender, _amount);
        return _amount;
    }

    function withdrawIfDisabled(address _withdrawToken) external nonReentrant returns (uint256) {
        require(vaultState.isDisabled, "vault is not disabled");
        require(allowedDepositTokens[_withdrawToken], "!_withdrawToken");

        // We do a max redeem before initiating a withdrawal
        // But we check if they must first have unredeemed shares
        if (depositReceipts[msg.sender].amount > 0 || depositReceipts[msg.sender].unredeemedShares > 0) {
            _redeem(0, true);
        }

        uint256 withdrawalShares = balanceOf(msg.sender);

        uint256 withdrawAmount = ShareMath.sharesToAsset(
            withdrawalShares,
            roundPricePerShare[vaultState.round - 1],
            vaultParams.decimals
        );
        require(withdrawAmount > 0, "!withdrawAmount");

        emit Withdraw(msg.sender, withdrawAmount, withdrawalShares);

        _burn(address(this), withdrawalShares);

        return _transferAsset(_withdrawToken, withdrawAmount);
    }

    /**
     * @notice Completes a scheduled withdrawal from a past round. Uses finalized pps for the round
     */
    function completeWithdraw(address _withdrawToken) external nonReentrant {
        require(!vaultState.isDisabled, "vault is disabled, use withdrawIfDisabled");
        require(allowedDepositTokens[_withdrawToken], "!_withdrawToken");

        uint256 withdrawAmount = _completeWithdraw(_withdrawToken);
        lastQueuedWithdrawAmount = uint128(uint256(lastQueuedWithdrawAmount).sub(withdrawAmount));
    }

    /**
     * @notice Completes a scheduled withdrawal from a past round. Uses finalized pps for the round
     * @return withdrawAmount the current withdrawal amount
     */
    function _completeWithdraw(address _withdrawToken) internal returns (uint256) {
        Vault.Withdrawal storage withdrawal = withdrawals[msg.sender];

        uint256 withdrawalShares = withdrawal.shares;
        uint256 withdrawalRound = withdrawal.round;

        // This checks if there is a withdrawal
        require(withdrawalShares > 0, "Not initiated");

        require(withdrawalRound < vaultState.round, "Round not closed");

        // We leave the round number as non-zero to save on gas for subsequent writes
        withdrawals[msg.sender].shares = 0;
        vaultState.queuedWithdrawShares = uint128(uint256(vaultState.queuedWithdrawShares).sub(withdrawalShares));

        uint256 withdrawAmount = ShareMath.sharesToAsset(
            withdrawalShares,
            roundPricePerShare[withdrawalRound],
            vaultParams.decimals
        );
        require(withdrawAmount > 0, "!withdrawAmount");

        emit Withdraw(msg.sender, withdrawAmount, withdrawalShares);

        _burn(address(this), withdrawalShares);

        return _transferAsset(_withdrawToken, withdrawAmount);
    }

    /*
     * @notice Helper function that helps to save gas for writing values into the roundPricePerShare map.
     *         Writing `1` into the map makes subsequent writes warm, reducing the gas from 20k to 5k.
     *         Having 1 initialized beforehand will not be an issue as long as we round down share calculations to 0.
     * @param numRounds is the number of rounds to initialize in the map
     */
    function initRounds(uint256 numRounds) external {
        require(numRounds > 0, "!numRounds");

        uint256 _round = vaultState.round;
        for (uint256 i = 0; i < numRounds; i++) {
            uint256 index = _round + i;
            require(roundPricePerShare[index] == 0, "Initialized"); // AVOID OVERWRITING ACTUAL VALUES
            roundPricePerShare[index] = ShareMath.PLACEHOLDER_UINT;
            emit RoundInit(index);
        }
    }

    /**
     * @notice Rolls the vault's funds into a new short position.
     */
    function rollToNextOption() external onlyKeeper nonReentrant returns (uint256 lockedBalanceInCollateralToken) {
        require(!vaultState.isDisabled, "vault is disabled");
        uint256 queuedWithdrawAmount = _rollToNextOption(uint256(lastQueuedWithdrawAmount));

        lastQueuedWithdrawAmount = queuedWithdrawAmount;

        // Locked balance denominated in `collateralToken`
        // We are subtracting `collateralAsset` balance by queuedWithdrawAmount

        lockedBalanceInCollateralToken = collateralToken.balanceOf(address(this)).sub(queuedWithdrawAmount);

        collateralToken.transfer(msg.sender, lockedBalanceInCollateralToken);

        emit OpenShort(lockedBalanceInCollateralToken, msg.sender);

        return (lockedBalanceInCollateralToken);
    }

    /*
     * @notice Helper function that performs most administrative tasks
     * such as setting next option, minting new shares, getting vault fees, etc.
     * @param lastQueuedWithdrawAmount is old queued withdraw amount
     * @return newOption is the new option address
     * @return queuedWithdrawAmount is the queued amount for withdrawal
     */
    function _rollToNextOption(uint256 _lastQueuedWithdrawAmount) internal returns (uint256) {
        (
            uint256 lockedBalance,
            uint256 queuedWithdrawAmount,
            uint256 newPricePerShare,
            uint256 mintShares,
            uint256 performanceFeeInAsset,
            uint256 totalVaultFee
        ) = CollateralVaultLifecycle.rollover(
                vaultState,
                CollateralVaultLifecycle.RolloverParams(
                    vaultParams.decimals,
                    totalBalance(),
                    totalSupply(),
                    _lastQueuedWithdrawAmount,
                    performanceFee,
                    managementFee
                )
            );

        // Finalize the pricePerShare at the end of the round
        uint256 currentRound = vaultState.round;
        roundPricePerShare[currentRound] = newPricePerShare;

        address recipient = feeRecipient;

        emit CollectVaultFees(performanceFeeInAsset, totalVaultFee, currentRound, recipient);

        vaultState.totalPending = 0;
        vaultState.round = uint16(currentRound + 1);
        ShareMath.assertUint104(lockedBalance);
        vaultState.lockedAmount = uint104(lockedBalance);

        _mint(address(this), mintShares);

        if (totalVaultFee > 0) {
            NeuronPoolUtils.unwrapAndWithdraw(WETH, vaultParams.collateralAsset, totalVaultFee, recipient);
        }

        return (queuedWithdrawAmount);
    }

    function disableVault() external onlyOwner {
        require(vaultState.lockedAmount == 0, "lockedAmount != 0");
        vaultState.isDisabled = true;
        // Do not take management fee when disabled
        managementFee = 0;

        uint256 queuedWithdrawAmount = _rollToNextOption(uint256(lastQueuedWithdrawAmount));
        lastQueuedWithdrawAmount = queuedWithdrawAmount;
    }

    function isDisabled() external view returns (bool) {
        return vaultState.isDisabled;
    }

    /**
     * @notice Sets the next option the vault will be shorting, and closes the existing short.
     *         This allows all the users to withdraw if the next option is malicious.
     */
    function commitAndClose(address premiumToken) external onlyKeeper nonReentrant {
        // Wrap premium to neuron pool tokens
        uint256 premiumBalance = IERC20(premiumToken).balanceOf(address(this));
        if (premiumBalance != 0) {
            IERC20(premiumToken).safeApprove(address(collateralToken), premiumBalance);
            uint256 depositReturn = collateralToken.deposit(premiumToken, premiumBalance);
            emit PremiumSwap(premiumBalance, depositReturn, vaultState.round);
        }

        uint256 lockedAmount = vaultState.lockedAmount;
        vaultState.lastLockedAmount = uint104(lockedAmount);
        vaultState.lockedAmount = 0;
    }

    /************************************************
     *  GETTERS
     ***********************************************/

    function getVaultParams() external view returns (Vault.CollateralVaultParams memory) {
        return vaultParams;
    }

    /**
     * @notice Returns the asset balance held on the vault for the account
     * @param account is the address to lookup balance for
     * @return the amount of `asset` custodied by the vault for the user
     */
    function accountVaultBalance(address account) external view returns (uint256) {
        uint256 _decimals = vaultParams.decimals;
        uint256 assetPerShare = ShareMath.pricePerShare(
            totalSupply(),
            totalBalance(),
            vaultState.totalPending,
            _decimals
        );
        return ShareMath.sharesToAsset(shares(account), assetPerShare, _decimals);
    }

    /**
     * @notice Getter for returning the account's share balance including unredeemed shares
     * @param account is the account to lookup share balance for
     * @return the share balance
     */
    function shares(address account) public view returns (uint256) {
        (uint256 heldByAccount, uint256 heldByVault) = shareBalances(account);
        return heldByAccount.add(heldByVault);
    }

    /**
     * @notice Getter for returning the account's share balance split between account and vault holdings
     * @param account is the account to lookup share balance for
     * @return heldByAccount is the shares held by account
     * @return heldByVault is the shares held on the vault (unredeemedShares)
     */
    function shareBalances(address account) public view returns (uint256 heldByAccount, uint256 heldByVault) {
        Vault.DepositReceipt memory depositReceipt = depositReceipts[account];

        if (depositReceipt.round < ShareMath.PLACEHOLDER_UINT) {
            return (balanceOf(account), 0);
        }

        uint256 unredeemedShares = depositReceipt.getSharesFromReceipt(
            vaultState.round,
            roundPricePerShare[depositReceipt.round],
            vaultParams.decimals
        );

        return (balanceOf(account), unredeemedShares);
    }

    /**
     * @notice The price of a unit of share denominated in the `asset`
     */
    function pricePerShare() external view returns (uint256) {
        return ShareMath.pricePerShare(totalSupply(), totalBalance(), vaultState.totalPending, vaultParams.decimals);
    }

    /**
     * @notice Returns the vault's total balance, including the amounts locked into a short position
     * @return total balance of the vault, including the amounts locked in third party protocols
     */
    function totalBalance() public view returns (uint256) {
        return uint256(vaultState.lockedAmount).add(collateralToken.balanceOf(address(this)));
    }

    /**
     * @notice Returns the token decimals
     */
    function decimals() public view override returns (uint8) {
        return vaultParams.decimals;
    }

    function cap() external view returns (uint256) {
        return vaultParams.cap;
    }

    function totalPending() external view returns (uint256) {
        return vaultState.totalPending;
    }
}
