import worker from './worker'
import { withDevIdentity } from '../../src/modules/operator-auth/dev/index.mjs'
import { authConfig, runtimeBindings } from '../../src/auth.server'
export default withDevIdentity(worker, { bindings: runtimeBindings, config: authConfig })
