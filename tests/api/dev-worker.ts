import worker from './worker'
import { withInvitedPeople } from '../../src/dev/invited-people.mjs'
import { withDevIdentity } from '../../src/modules/operator-auth/dev/index.mjs'
import { authConfig, runtimeBindings } from '../../src/auth.server'
export default withInvitedPeople(withDevIdentity(worker, { bindings: runtimeBindings, config: authConfig }))
