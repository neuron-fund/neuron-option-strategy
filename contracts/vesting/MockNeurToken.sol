pragma solidity 0.8.9;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IVestingFactory} from "./IVestingFactory.sol";

contract MockNeurToken is ERC20 {
    uint8 _decimals;

    struct VestingParams {
        address[] _recipients;
        uint256[] _unlockTimes;
        uint256[] _cliffTimes;
        uint256[] _amounts;
    }

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 decimals_,
        address _vestingFactory,
        address _vestingImplementation,
        address[] memory _vestingFactoryAdmins,
        VestingParams memory _vestingParams
    ) ERC20(_name, _symbol) {
        _decimals = decimals_;

        // Init vesting factory
        IVestingFactory vestingFactory = IVestingFactory(_vestingFactory);
        address[] memory vestingFactoryAdmins = new address[](_vestingFactoryAdmins.length + 1);
        for (uint256 i = 0; i < _vestingFactoryAdmins.length; i++) {
            vestingFactoryAdmins[i] = _vestingFactoryAdmins[i];
        }
        vestingFactoryAdmins[_vestingFactoryAdmins.length] = address(this);
        vestingFactory.initialize(vestingFactoryAdmins, address(this), _vestingImplementation);

        uint256 numberOfVestings = _vestingParams._recipients.length;

        // Deploy new vesting contracts
        address[] memory vestings = vestingFactory.deployVestings(numberOfVestings);

        for (uint256 i = 0; i < vestings.length; i++) {
            _mint(vestings[i], _vestingParams._amounts[i]);
        }

        vestingFactory.initVestings(
            vestings,
            _vestingParams._recipients,
            _vestingParams._unlockTimes,
            _vestingParams._cliffTimes,
            _vestingParams._amounts
        );
    }

    function mint(address _reciever, uint256 _amount) external {
        _mint(_reciever, _amount);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}
