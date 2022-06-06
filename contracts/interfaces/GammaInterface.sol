// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

interface IONtoken {
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);

    function DOMAIN_SEPARATOR() external view returns (bytes32);

    function allowance(address owner, address spender) external view returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);

    function balanceOf(address account) external view returns (uint256);

    function burnONtoken(address account, uint256 amount) external;

    function collateralAssets(uint256) external view returns (address);

    function collateralsAmounts(uint256) external view returns (uint256);

    function collateralsValues(uint256) external view returns (uint256);

    function collaterizedTotalAmount() external view returns (uint256);

    function controller() external view returns (address);

    function decimals() external view returns (uint8);

    function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool);

    function expiryTimestamp() external view returns (uint256);

    function getCollateralAssets() external view returns (address[] memory);

    function getCollateralConstraints() external view returns (uint256[] memory);

    function getCollateralsAmounts() external view returns (uint256[] memory);

    function getCollateralsValues() external view returns (uint256[] memory);

    function getONtokenDetails()
        external
        view
        returns (
            address[] memory,
            uint256[] memory,
            uint256[] memory,
            uint256[] memory,
            address,
            address,
            uint256,
            uint256,
            bool,
            uint256
        );

    function increaseAllowance(address spender, uint256 addedValue) external returns (bool);

    function init(
        address _addressBook,
        address _underlyingAsset,
        address _strikeAsset,
        address[] memory _collateralAssets,
        uint256[] memory _collateralConstraints,
        uint256 _strikePrice,
        uint256 _expiryTimestamp,
        bool _isPut
    ) external;

    function isPut() external view returns (bool);

    function mintONtoken(
        address account,
        uint256 amount,
        uint256[] memory collateralsAmountsForMint,
        uint256[] memory collateralsValuesForMint
    ) external;

    function name() external view returns (string memory);

    function nonces(address owner) external view returns (uint256);

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function reduceCollaterization(
        uint256[] memory collateralsAmountsForReduce,
        uint256[] memory collateralsValuesForReduce,
        uint256 onTokenAmountBurnt
    ) external;

    function strikeAsset() external view returns (address);

    function strikePrice() external view returns (uint256);

    function symbol() external view returns (string memory);

    function totalSupply() external view returns (uint256);

    function transfer(address recipient, uint256 amount) external returns (bool);

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool);

    function underlyingAsset() external view returns (address);
}

interface IONtokenFactory {
    event ONtokenCreated(
        address tokenAddress,
        address creator,
        address indexed underlying,
        address indexed strike,
        address[] indexed collateral,
        uint256 strikePrice,
        uint256 expiry,
        bool isPut
    );

    function addressBook() external view returns (address);

    function createONtoken(
        address _underlyingAsset,
        address _strikeAsset,
        address[] memory _collateralAssets,
        uint256[] memory _collateralConstraints,
        uint256 _strikePrice,
        uint256 _expiry,
        bool _isPut
    ) external returns (address);

    function getONtoken(
        address _underlyingAsset,
        address _strikeAsset,
        address[] memory _collateralAssets,
        uint256[] memory _collateralConstraints,
        uint256 _strikePrice,
        uint256 _expiry,
        bool _isPut
    ) external view returns (address);

    function getONtokensLength() external view returns (uint256);

    function getTargetONtokenAddress(
        address _underlyingAsset,
        address _strikeAsset,
        address[] memory _collateralAssets,
        uint256[] memory _collateralConstraints,
        uint256 _strikePrice,
        uint256 _expiry,
        bool _isPut
    ) external view returns (address);

    function onTokens(uint256) external view returns (address);
}

interface IController {
    event AccountOperatorUpdated(address indexed accountOwner, address indexed operator, bool isSet);
    event CallExecuted(address indexed from, address indexed to, bytes data);
    event CallRestricted(bool isRestricted);
    event CollateralAssetDeposited(
        address indexed asset,
        address indexed accountOwner,
        address indexed from,
        uint256 vaultId,
        uint256 amount
    );
    event CollateralAssetWithdrawed(
        address indexed asset,
        address indexed accountOwner,
        address indexed to,
        uint256 vaultId,
        uint256 amount
    );
    event Donated(address indexed donator, address indexed asset, uint256 amount);
    event FullPauserUpdated(address indexed oldFullPauser, address indexed newFullPauser);
    event LongONtokenDeposited(
        address indexed onToken,
        address indexed accountOwner,
        address indexed from,
        uint256 vaultId,
        uint256 amount
    );
    event LongONtokenWithdrawed(
        address indexed onToken,
        address indexed accountOwner,
        address indexed to,
        uint256 vaultId,
        uint256 amount
    );
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PartialPauserUpdated(address indexed oldPartialPauser, address indexed newPartialPauser);
    event Redeem(
        address indexed onToken,
        address indexed redeemer,
        address indexed receiver,
        address[] collateralAssets,
        uint256 onTokenBurned,
        uint256[] payouts
    );
    event ShortONtokenBurned(
        address indexed onToken,
        address indexed accountOwner,
        address indexed sender,
        uint256 vaultId,
        uint256 amount
    );
    event ShortONtokenMinted(
        address indexed onToken,
        address indexed accountOwner,
        address indexed to,
        uint256 vaultId,
        uint256 amount
    );
    event SystemFullyPaused(bool isPaused);
    event SystemPartiallyPaused(bool isPaused);
    event VaultOpened(address indexed accountOwner, uint256 vaultId);
    event VaultSettled(
        address indexed accountOwner,
        address indexed shortONtoken,
        address to,
        uint256[] payouts,
        uint256 vaultId
    );

    function accountVaultCounter(address) external view returns (uint256);

    function addressbook() external view returns (address);

    function calculator() external view returns (address);

    function callRestricted() external view returns (bool);

    function canSettleAssets(
        address _underlying,
        address _strike,
        address[] memory _collaterals,
        uint256 _expiry
    ) external view returns (bool);

    function donate(address _asset, uint256 _amount) external;

    function fullPauser() external view returns (address);

    function getMaxCollateratedShortAmount(address user, uint256 vault_id) external view returns (uint256);

    function getProceed(address _owner, uint256 _vaultId) external view returns (uint256[] memory);

    function getVaultWithDetails(address _owner, uint256 _vaultId)
        external
        view
        returns (MarginVault.Vault memory, uint256);

    function hasExpired(address _onToken) external view returns (bool);

    function initialize(address _addressBook, address _owner) external;

    function isOperator(address _owner, address _operator) external view returns (bool);

    function isSettlementAllowed(address _onToken) external view returns (bool);

    function operate(Actions.ActionArgs[] memory _actions) external;

    function oracle() external view returns (address);

    function owner() external view returns (address);

    function partialPauser() external view returns (address);

    function pool() external view returns (address);

    function refreshConfiguration() external;

    function renounceOwnership() external;

    function setCallRestriction(bool _isRestricted) external;

    function setFullPauser(address _fullPauser) external;

    function setOperator(address _operator, bool _isOperator) external;

    function setPartialPauser(address _partialPauser) external;

    function setSystemFullyPaused(bool _fullyPaused) external;

    function setSystemPartiallyPaused(bool _partiallyPaused) external;

    function sync(address _owner, uint256 _vaultId) external;

    function systemFullyPaused() external view returns (bool);

    function systemPartiallyPaused() external view returns (bool);

    function transferOwnership(address newOwner) external;

    function vaults(address, uint256)
        external
        view
        returns (
            address shortONtoken,
            address longONtoken,
            uint256 shortAmount,
            uint256 longAmount,
            uint256 usedLongAmount
        );

    function whitelist() external view returns (address);
}

interface MarginVault {
    struct Vault {
        address shortONtoken;
        address longONtoken;
        address[] collateralAssets;
        uint256 shortAmount;
        uint256 longAmount;
        uint256 usedLongAmount;
        uint256[] collateralAmounts;
        uint256[] reservedCollateralAmounts;
        uint256[] usedCollateralValues;
        uint256[] availableCollateralAmounts;
    }
}

interface Actions {
    struct ActionArgs {
        uint8 actionType;
        address owner;
        address secondAddress;
        address[] assets;
        uint256 vaultId;
        uint256[] amounts;
        bytes data;
    }

    enum ActionType {
        OpenVault,
        MintShortOption,
        BurnShortOption,
        DepositLongOption,
        WithdrawLongOption,
        DepositCollateral,
        WithdrawCollateral,
        SettleVault,
        Redeem,
        Call
    }
}

interface IOracle {
    function isLockingPeriodOver(address _asset, uint256 _expiryTimestamp) external view returns (bool);

    function isDisputePeriodOver(address _asset, uint256 _expiryTimestamp) external view returns (bool);

    function getExpiryPrice(address _asset, uint256 _expiryTimestamp) external view returns (uint256, bool);

    function getDisputer() external view returns (address);

    function getPricer(address _asset) external view returns (address);

    function getPrice(address _asset) external view returns (uint256);

    function getPricerLockingPeriod(address _pricer) external view returns (uint256);

    function getPricerDisputePeriod(address _pricer) external view returns (uint256);

    function getChainlinkRoundData(address _asset, uint80 _roundId) external view returns (uint256, uint256);

    // Non-view function

    function setAssetPricer(address _asset, address _pricer) external;

    function setLockingPeriod(address _pricer, uint256 _lockingPeriod) external;

    function setDisputePeriod(address _pricer, uint256 _disputePeriod) external;

    function setExpiryPrice(
        address _asset,
        uint256 _expiryTimestamp,
        uint256 _price
    ) external;

    function disputeExpiryPrice(
        address _asset,
        uint256 _expiryTimestamp,
        uint256 _price
    ) external;

    function setDisputer(address _disputer) external;
}

interface IPricer {
    function getPrice() external view returns (uint256);
}
