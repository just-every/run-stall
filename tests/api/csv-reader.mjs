// Independent standard-library reader; never reuse the app's CSV writer/parser.
import { execFileSync } from 'node:child_process';
export function readCsv(csv) {
 return JSON.parse(execFileSync('python3',['-c','import csv,io,json,sys; print(json.dumps(list(csv.DictReader(io.StringIO(sys.stdin.read(),newline="")))) )'],{input:csv,encoding:'utf8'}));
}
