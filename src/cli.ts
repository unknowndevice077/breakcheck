import { Command, Option } from 'commander'

const program = new Command()

program
  .name('bench')
  .version('1.0.0')
  .option('-d, --debug', 'output extra debugging')
  .option('-p, --port <number>', 'port', '3000')
  .addOption(new Option('-m, --mode <mode>').choices(['dev', 'prod']))
  .storeOptionsAsProperties(false)

program
  .command('serve')
  .description('start the server')
  .argument('[dir]', 'directory', '.')
  .action((dir: string, options: { port: string }) => {
    console.log(`serving ${dir} on ${options.port}`)
  })

program.parse(process.argv)

const opts = program.opts()
if (opts.debug) console.log(opts)

export function excess(): string[] {
  return program.args
}
