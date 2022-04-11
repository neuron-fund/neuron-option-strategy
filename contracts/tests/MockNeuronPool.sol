// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "hardhat/console.sol";

contract MockNeuronPool is ERC20 {
    address public asset;
    uint256 public balance;

    constructor(address _asset) ERC20("MockNeuronPool", "MNP") {
        asset = _asset;
    }

    function pricePerShare() public view returns (uint256) {
        uint256 totalSupply = totalSupply();
        return totalSupply == 0 ? 0 : (balance * (10**decimals())) / totalSupply;
    }

    function deposit(uint256 _amount) external {
        console.log("_amount", _amount);
        console.log("balance BEFORE", balance);
        uint256 balanceBefore = balance;
        balance += _amount;
        console.log("balance AFTER", balance);
        IERC20(asset).transferFrom(msg.sender, address(this), _amount);
        console.log("deposit ~ asset", asset);
        uint256 shares;
        uint256 totalSupply = totalSupply();
        console.log("totalSupply", totalSupply);
        if (totalSupply == 0) {
            console.log("shares = amount");
            shares = _amount;
        } else {
            shares = (_amount * totalSupply) / balanceBefore;
        }
        console.log("shares", shares);
        _mint(msg.sender, shares);
    }

    function withdraw(uint256 _shares) external {
        uint256 amount = (_shares * pricePerShare()) / (10**decimals());
        console.log("withdraw ~ amount", amount);
        balance -= amount;
        _burn(msg.sender, _shares);
        IERC20(asset).transfer(msg.sender, amount);
        console.log("withdraw ~ asset", asset);
    }
}
