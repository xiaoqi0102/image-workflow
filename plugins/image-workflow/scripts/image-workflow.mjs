#!/usr/bin/env node
import { executeCommand, printError, printResult } from "../src/cli/commands.mjs";
import { parseCommandLine } from "../src/cli/args.mjs";

async function main(argv) {
  try {
    const { positionals, options } = parseCommandLine(argv);
    const result = await executeCommand(positionals, options);
    printResult(result);
    return result?.value?.exitCode ?? 0;
  } catch (error) {
    printError(error);
    return 1;
  }
}

const exitCode = await main(process.argv.slice(2));
process.exitCode = exitCode;
