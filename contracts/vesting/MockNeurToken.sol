pragma solidity 0.8.9;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockNeurToken is ERC20 {
    uint8 _decimals;

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 decimals_,
        address[] memory initialHolders,
        uint256[] memory initialBalances
    ) ERC20(_name, _symbol) {
        _decimals = decimals_;

        require(
            initialHolders.length == initialBalances.length,
            "initialHolders and initialBalances must have the same length"
        );

        for (uint256 i = 0; i < initialHolders.length; i++) {
            require(initialHolders[i] != address(0), "initialHolders cannot contain zero address");
            require(initialBalances[i] > 0, "initialBalances must be greater than zero");
            _mint(initialHolders[i], initialBalances[i]);
        }
    }

    function mint(address _reciever, uint256 _amount) external {
        _mint(_reciever, _amount);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}
