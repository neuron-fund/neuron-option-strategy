// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IVesting} from "./IVesting.sol";

contract VestingFactory is Initializable {
    uint256 public constant SECONDS_IN_ONE_YEAR = 31536000;

    IERC20 public token;
    address public vestingImplementation;

    mapping(address => bool) public admins;

    event VestingDeployed(address indexed vesting);

    event VestingInitialized(
        address vesting,
        address deployer,
        address indexed recipient,
        uint256 lockedAmount,
        uint256 unlockTime,
        uint256 cliffTime
    );

    function initialize(
        address[] memory _admins,
        address _tokenAddress,
        address _vestingImplementation
    ) external initializer {
        require(_tokenAddress != address(0), "Token address cannot be zero address");

        for (uint256 i = 0; i < _admins.length; i++) {
            require(_admins[i] != address(0), "Admin cannot be zero address");
            admins[_admins[i]] = true;
        }

        token = IERC20(_tokenAddress);
        vestingImplementation = _vestingImplementation;
    }

    modifier onlyAdmin() {
        require(admins[msg.sender], "Only admin can call this function");
        _;
    }

    function balance() public view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function addAdmin(address _newAdmin) external {
        require(admins[msg.sender], "Only admins may add new admins");
        require(_newAdmin != address(0));
        admins[_newAdmin] = true;
    }

    function removeAdmin(address _oldAdmin) external {
        require(admins[msg.sender], "Only admins may remove admins");
        require(_oldAdmin != address(0));
        admins[_oldAdmin] = false;
    }

    function deployVestings(uint256 numberOfContracts) external onlyAdmin returns (address[] memory) {
        require(numberOfContracts > 0, "Number of contracts must be greater than zero");

        address[] memory vestings = new address[](numberOfContracts);
        for (uint256 i = 0; i < numberOfContracts; i++) {
            address vesting = Clones.clone(vestingImplementation);
            vestings[i] = vesting;
            emit VestingDeployed(vesting);
        }

        return vestings;
    }

    function initVestings(
        address[] memory _vestings,
        address[] memory _recipients,
        uint256[] memory _unlockTimes,
        uint256[] memory _cliffTimes,
        uint256[] memory _amounts
    ) external {
        require(_recipients.length > 0, "Must deploy at least one vesting contract");
        require(
            _vestings.length == _recipients.length &&
                _vestings.length == _unlockTimes.length &&
                _vestings.length == _amounts.length &&
                _vestings.length == _cliffTimes.length,
            "Arrays must be of equal length"
        );

        for (uint256 i = 0; i < _recipients.length; i++) {
            IVesting(_vestings[i]).initialize(
                address(token),
                _recipients[i],
                _unlockTimes[i],
                _cliffTimes[i],
                _amounts[i]
            );

            emit VestingInitialized(
                _vestings[i],
                msg.sender,
                _recipients[i],
                _amounts[i],
                _unlockTimes[i],
                _cliffTimes[i]
            );
        }
    }
}
