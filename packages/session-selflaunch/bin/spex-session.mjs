#!/usr/bin/env node
import { runCli } from '../dist/cli.js'

process.exitCode = await runCli()
