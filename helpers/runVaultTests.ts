import { initiateVault } from './vault'
import { testsParams } from './testParams'
import { revertToSnapShot, takeSnapshot } from './time'

type InitVaultReturn = Awaited<ReturnType<typeof initiateVault>>

type RunVaultTestsCallback = (params: InitVaultReturn) => Promise<() => void>

export function runVaultTests(describeTitle: string, testsCallback: RunVaultTestsCallback) {
  describe(describeTitle, () => {
    let beforeSnapshotId: string

    before(async () => {
      beforeSnapshotId = await takeSnapshot()
      process.on('exit', async () => await revertToSnapShot(beforeSnapshotId))

      for (const testParam of testsParams) {
        let initParams: InitVaultReturn
        let tests: () => void
        try {
          initParams = await initiateVault(testParam)
          tests = await testsCallback(initParams)
        } catch (e) {
          await revertToSnapShot(beforeSnapshotId)
          throw e
        }
        let initSnapshotId = await takeSnapshot()

        describe(`${describeTitle}: ${testParam.name}`, () => {
          tests()
          after(async () => {
            await revertToSnapShot(beforeSnapshotId)
          })
          afterEach(async () => {
            await revertToSnapShot(initSnapshotId)
            // If we dont take snapshot again it wont revert second time for some reason
            initSnapshotId = await takeSnapshot()
          })
        })
      }
    })

    // Dummy test, without it "before" hook wont work therefore wont not create other tests
    it.skip('', () => {})
  })
}
