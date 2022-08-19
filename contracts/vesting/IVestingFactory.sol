pragma solidity 0.8.9;

interface IVestingFactory {
    event Initialized(uint8 version);
    event VestingDeployed(address indexed vesting);
    event VestingInitialized(
        address vesting,
        address deployer,
        address indexed recipient,
        uint256 lockedAmount,
        uint256 unlockTime,
        uint256 cliffTime
    );

    function SECONDS_IN_ONE_YEAR() external view returns (uint256);

    function addAdmin(address _newAdmin) external;

    function admins(address) external view returns (bool);

    function balance() external view returns (uint256);

    function deployVestings(uint256 numberOfContracts) external returns (address[] memory);

    function initVestings(
        address[] memory _vestings,
        address[] memory _recipients,
        uint256[] memory _unlockTimes,
        uint256[] memory _cliffTimes,
        uint256[] memory _amounts
    ) external;

    function initialize(
        address[] memory _admins,
        address _tokenAddress,
        address _VestingImplementation
    ) external;

    function vestingImplementation() external view returns (address);

    function removeAdmin(address _oldAdmin) external;

    function token() external view returns (address);
}
