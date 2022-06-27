import { initiateVault, VaultTestParams } from './vault'
import { testsParams } from './testParams'
import { revertToSnapShot, takeSnapshot } from './time'

type InitVaultReturn = Awaited<ReturnType<typeof initiateVault>>

type RunVaultTestsCallback = (params: InitVaultReturn) => Promise<() => void>

export function runVaultTests(describeTitle: string, testsCallback: RunVaultTestsCallback) {
  let i = 0
  const last = testsParams.length - 1
  let nextTestParam = testsParams[i]

  const addNextTest = (testParam: VaultTestParams) => {
    describe(`${describeTitle}`, function () {
      before(async function () {
        let beforeAllSnapshotId
        beforeAllSnapshotId = await takeSnapshot()

        let beforeItRunSnapshotId
        // Firstly deploys all the vaults and register all tests
        let initParams: InitVaultReturn
        let tests: () => void
        try {
          initParams = await initiateVault(testParam)
          tests = await testsCallback(initParams)
          beforeItRunSnapshotId = await takeSnapshot()
        } catch (e) {
          await revertToSnapShot(beforeAllSnapshotId)
          throw e
        }

        // Then runs test for each test param
        describe(`${describeTitle}: ${testParam.name}`, function () {
          if (i < last) {
            i++
            nextTestParam = testsParams[i]
            before(async () => {
              addNextTest(nextTestParam)
            })
          }
          after(async function () {
            await revertToSnapShot(beforeAllSnapshotId)
            beforeItRunSnapshotId = await takeSnapshot()
          })

          afterEach(async function () {
            await revertToSnapShot(beforeItRunSnapshotId)
            // If we dont take snapshot again it wont revert second time
            beforeItRunSnapshotId = await takeSnapshot()
          })

          tests()
        })
      })

      it.skip('', () => {})
    })
  }

  describe('', () => {
    addNextTest(nextTestParam)

    it.skip('', function () {})
  })
}
