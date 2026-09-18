import { describe, expect, it } from 'vitest'
import { argumentsFor } from '../src/main/shell-arguments.js'

// Getting the encoding preamble wrong shows up as mangled Portuguese the first
// time somebody dictates a word with an accent, which is a poor way to find out.

describe('starting a shell', () => {
  it('tells PowerShell to speak UTF-8, and hides the setup', () => {
    const args = argumentsFor('powershell.exe')
    const command = args.join(' ')

    expect(args).toContain('-NoExit')
    expect(command).toContain('UTF8')
    expect(command).toContain('Clear-Host')
  })

  it('recognises PowerShell by its file name, not by the whole path', () => {
    expect(argumentsFor('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')).toEqual(
      argumentsFor('powershell.exe'),
    )
  })

  it('recognises PowerShell whatever the casing', () => {
    expect(argumentsFor('PowerShell.EXE')).toEqual(argumentsFor('powershell.exe'))
  })

  it('handles the newer pwsh the same way', () => {
    expect(argumentsFor('pwsh.exe')).toEqual(argumentsFor('powershell.exe'))
  })

  it('sets the code page for the old Command Prompt', () => {
    expect(argumentsFor('cmd.exe').join(' ')).toContain('chcp 65001')
  })

  it('leaves a shell it does not know to its own configuration', () => {
    // Guessing at flags for an unknown shell would break the launch outright.
    expect(argumentsFor('bash.exe')).toEqual([])
    expect(argumentsFor('nushell.exe')).toEqual([])
  })

  it('does not fall over when asked about nothing', () => {
    expect(argumentsFor(undefined)).toEqual([])
    expect(argumentsFor('')).toEqual([])
  })
})
