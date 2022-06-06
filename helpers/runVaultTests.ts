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
      for (const testParam of testsParams) {
        const initParams = await initiateVault(testParam)
        const tests = await testsCallback(initParams)
        const initSnapshotId = await takeSnapshot()

        describe(`${describeTitle}: ${testParam.name}`, () => {
          afterEach(async () => {
            await revertToSnapShot(initSnapshotId)
          })

          after(async () => {
            await revertToSnapShot(beforeSnapshotId)
          })

          tests()
        })
      }
    })

    // Dummy test, without it "before" hook wont work therefore wont not create other tests
    it.skip('', () => {})
  })
}
