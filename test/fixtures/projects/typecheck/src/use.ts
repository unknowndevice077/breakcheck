import { oldFn, configure, same } from 'widget'
import { missing } from 'not-installed'

oldFn()
configure({ legacy: true })
same()
missing()
