/**
 * The preload script is the whole contract between the renderer and the machine
 * (`docs/PLAN.md` §3). It is deliberately EMPTY at this point in the build: the message set,
 * its schemas and the named bridge methods are declared once in `shared/ipc.ts` and exposed
 * here, and that is subtask S4.
 *
 * What matters now is what is *not* here, and stays not here: `ipcRenderer` is never handed to
 * the page, and no function on this bridge will ever take a channel name from its caller. The
 * surface has to stay enumerable by reading this file.
 */
export {}
