import { initiateVault } from './vault'
import { testsParams } from './testParams'
import { revertToSnapShot, takeSnapshot } from './time'

type InitVaultReturn = Awaited<ReturnType<typeof initiateVault>>

type RunVaultTestsCallback = (params: InitVaultReturn) => Promise<() => void>

export function runVaultTests(describeTitle: string, testsCallback: RunVaultTestsCallback) {
  describe(describeTitle, () => {
    let beforeDeploySnapshotId: string

    before(async () => {
      beforeDeploySnapshotId = await takeSnapshot()
      process.on('exit', async () => await revertToSnapShot(beforeDeploySnapshotId))

      // Firstly deploys all the vaults and register all tests
      for (const testParam of testsParams) {
        let initParams: InitVaultReturn
        let tests: () => void
        try {
          initParams = await initiateVault(testParam)
          tests = await testsCallback(initParams)
        } catch (e) {
          await revertToSnapShot(beforeDeploySnapshotId)
          throw e
        }

        // Then runs test for each test param
        describe(`${describeTitle}: ${testParam.name}`, () => {
          let beforeItRunSnapshotId
          before(async () => {
            beforeItRunSnapshotId = await takeSnapshot()
          })
          afterEach(async () => {
            await revertToSnapShot(beforeItRunSnapshotId)
            // If we dont take snapshot again it wont revert second time for some reason
            beforeItRunSnapshotId = await takeSnapshot()
          })
          tests()
        })
      }

      // After all revert to clean state
      describe('revert to before test', () => {
        after(async () => {
          await revertToSnapShot(beforeDeploySnapshotId)
        })

        // Required for "after" to work
        it.skip('', () => {})
      })
    })

    // Dummy test, without it "before" hook wont work therefore wont not create other tests
    it.skip('', () => {})
  })
}
