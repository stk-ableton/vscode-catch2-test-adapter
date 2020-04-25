[[Jump to README.md](../../README)]

# Debugger Configuration Template

```
catch2TestExplorer.debugConfigTemplate
```

Set the necessary debug configurations and the debug button will work.

If `catch2TestExplorer.debugConfigTemplate` value is `null` (default),

> it searches for configurations in the workspacefolder's `.vscode/launch.json`.
> It will choose the first one which's `"request"` property is `"launch"`
> and has `type` property with string value starting with `cpp`, `lldb` or `gdb`.
> (If you don't want this but also don't want to specify you own debugConfigTemplate
> use `"extensionOnly"` as value.)

In case it hasn't found one it will look after:

> 1. [`vadimcn.vscode-lldb`](https://github.com/vadimcn/vscode-lldb#quick-start),
> 2. [`webfreak.debug`](https://github.com/WebFreak001/code-debug),
> 3. [`ms-vscode.cpptools`](https://github.com/Microsoft/vscode-cpptools)
>
> extensions in order. If it finds one of it, it will use it automatically.
> For further details check [VSCode launch config](https://code.visualstudio.com/docs/editor/debugging#_launch-configurations).

**Remark**: This feature to work automatically (value: `null`) has a lot of requirements which are not listed here.
If it works it is good for you.
If it isn't.. I suggest to create your own `"catch2TestExplorer.debugConfigTemplate"` template.
If you read the _Related documents_ and still have a question feel free to open an issue.
Value `"extensionOnly"` will cause to skip the search of local launch configurations.

#### or user can manually fill it

For [`vadimcn.vscode-lldb`](https://github.com/vadimcn/vscode-lldb#quick-start) add something like this to settings.json:

```json
"catch2TestExplorer.debugConfigTemplate": {
  "type": "cppdbg",
  "MIMode": "lldb",
  "program": "${exec}",
  "args": "${args}",
  "cwd": "${cwd}",
  "env": "${envObj}",
  "externalConsole": false
}
```

#### Usable variables:

| Variable name   | Value meaning                                                        | Type                       |
| --------------- | -------------------------------------------------------------------- | -------------------------- |
| `${label}`      | The name of the test. Same as in the Test Explorer.                  | string                     |
| `${suiteLabel}` | The name of parent suites of the test. Same as in the Test Explorer. | string                     |
| `${exec}`       | The path of the executable.                                          | string                     |
| `${argsArray}`  | The arguments for the executable.                                    | string[]                   |
| `${argsStr}`    | Concatenated arguments for the executable.                           | string                     |
| `${cwd}`        | The current working directory for execution.                         | string                     |
| `${envObj}`     | The environment variables as object properties.                      | { [prop: string]: string } |

These variables will be substituted when a DebugConfiguration is created.

Note that `name` and `request` are filled, if they are undefined, so it is not necessary to set them.
`type` is necessary.