//SPDX-License-Identifier: GPL-3.0
pragma solidity 0.7.6;

import {SafeMathLegacy} from "./libraries/SafeMathLegacy.sol";
import {Welford} from "./libraries/Welford.sol";
import {DSMath} from "../vendor/DSMath.sol";
import {VolOracle} from "./core/VolOracle.sol";
import {Math} from "./libraries/Math.sol";
import {PRBMathSD59x18} from "./libraries/PRBMathSD59x18.sol";

contract TestVolOracle is VolOracle {
    using SafeMathLegacy for uint256;
    uint256 private _price;

    constructor(uint32 _period, uint256 _windowInDays) VolOracle(_period, _windowInDays) {}

    function mockCommit(bytes32 optionId) external {
        require(observations[optionId].length > 0, "!optionId initialize");

        (uint32 commitTimestamp, uint32 gapFromPeriod) = secondsFromPeriod();
        require(gapFromPeriod < commitPhaseDuration, "Not commit phase");

        uint256 price = getPrice(optionId);
        uint256 _lastPrice = lastPrices[optionId];
        uint256 periodReturn = _lastPrice > 0 ? DSMath.wdiv(price, _lastPrice) : 0;

        // logReturn is in 10**18
        // we need to scale it down to 10**8
        int256 logReturn = periodReturn > 0 ? PRBMathSD59x18.ln(int256(periodReturn)) / 10**10 : 0;

        Accumulator storage accum = accumulators[optionId];

        require(block.timestamp >= accum.lastTimestamp + period - commitPhaseDuration, "Committed");

        uint256 currentObservationIndex = accum.currentObservationIndex;

        (int256 newMean, int256 newDSQ) = Welford.update(
            observationCount(optionId, true),
            observations[optionId][currentObservationIndex],
            logReturn,
            accum.mean,
            accum.dsq
        );

        require(newMean < type(int96).max, ">I96");
        require(newDSQ < type(uint120).max, ">U120");

        accum.mean = int96(newMean);
        accum.dsq = uint120(newDSQ);
        accum.lastTimestamp = commitTimestamp;
        observations[optionId][currentObservationIndex] = logReturn;
        accum.currentObservationIndex = uint8((currentObservationIndex + 1) % windowSize);
        lastPrices[optionId] = price;

        emit Commit(uint32(commitTimestamp), int96(newMean), uint120(newDSQ), price, msg.sender);
    }

    function getPrice(bytes32) public view override returns (uint256) {
        return _price;
    }

    function setPrice(uint256 price) public {
        _price = price;
    }
}
