/** Minimal structural type for an object that can be disposed. Compatible with
 *  vscode.Disposable so existing consumers don't need to change shape; defined
 *  here so daemon-only modules don't import vscode. */
export interface Disposable {
  dispose(): unknown;
}
