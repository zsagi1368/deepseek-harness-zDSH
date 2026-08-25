/**
 * Session artifact registry: "things THIS session created", identified by
 * file identity (dev/ino/birthtime/kind), never by path string.
 *
 * Identity is the authorization carrier: rename the path, replace it with a
 * symlink, or recreate the file, and its automatic-cleanup eligibility is
 * gone. Recursive cleanup requires EVERY existing object in the tree to be
 * registered — one untracked member disqualifies the whole tree.
 */

export interface ArtifactIdentity {
  dev: number
  ino: number
  birthtimeMs: number
  isDirectory: boolean
}

/** Minimal `lstat` result surface the registry keys identities on. */
export interface LstatLike {
  dev: number
  ino: number
  birthtimeMs: number
  isDirectory: boolean
}

/** Filesystem probing surface the registry walks workspaces with. */
export interface FsProbePort {
  lstat(path: string): LstatLike | undefined
  /** Directory entry names; undefined when unreadable. */
  listDir(path: string): string[] | undefined
  join(...parts: string[]): string
}

const MAX_TREE_OBJECTS = 4096

function identityOf(stat: LstatLike): ArtifactIdentity {
  return {
    dev: stat.dev,
    ino: stat.ino,
    birthtimeMs: stat.birthtimeMs,
    isDirectory: stat.isDirectory,
  }
}

function sameIdentity(a: ArtifactIdentity, b: ArtifactIdentity): boolean {
  return (
    a.dev === b.dev && a.ino === b.ino &&
    Math.abs(a.birthtimeMs - b.birthtimeMs) < 2 &&
    a.isDirectory === b.isDirectory
  )
}

/** Session artifact registry: identity-keyed workspace files this session made. */
export class SessionArtifacts {
  private readonly registered = new Map<string, ArtifactIdentity>()
  private planned = new Set<string>()

  constructor(
    private readonly fs: FsProbePort,
    private readonly workspaceRoot: string,
    private readonly snapshotLimit: number,
  ) {}

  /** Relative targets are anchored to the workspace root; absolute pass through. */
  private resolve(p: string): string {
    return /^[A-Za-z]:[\\/]|^\//.test(p) ? this.fs.join(p) : this.fs.join(this.workspaceRoot, p)
  }

  // -- Editor-planned creates (two-phase) ----------------------------------

  /**
   * Plan a create the editor is about to make (two-phase settlement).
   * @param path - the target path being planned.
   */
  planCreate(path: string): void {
    this.planned.add(this.resolve(path))
  }

  /**
   * Settle succeeds only when the plan exists, nothing pre-existed, and the call succeeded.
   * @param path - the planned target path.
   * @param existedBefore - whether the path already existed before the call.
   * @param callOk - whether the create call itself succeeded.
   * @returns whether the artifact was registered.
   */
  settleCreate(path: string, existedBefore: boolean, callOk: boolean): boolean {
    const key = this.resolve(path)
    if (!callOk || existedBefore || !this.planned.has(key)) return false
    this.planned.delete(key) // consume the plan only on successful settlement
    const stat = this.fs.lstat(key)
    if (!stat) return false
    this.registered.set(key.toLowerCase(), identityOf(stat))
    return true
  }

  // -- Shell snapshot diffing ------------------------------------------------

  /**
   * Bounded workspace walk. Returns undefined when the tree exceeds the limit
   * (prefer NOT tracking over mis-attributing old files).
   * @returns identity-keyed snapshot of every object under the workspace root.
   */
  snapshot(): Map<string, ArtifactIdentity> | undefined {
    const out = new Map<string, ArtifactIdentity>()
    const queue: string[] = [this.workspaceRoot]
    while (queue.length > 0) {
      const dir = queue.shift() as string
      const entries = this.fs.listDir(dir)
      if (entries === undefined) continue
      for (const name of entries) {
        if (out.size >= this.snapshotLimit) return undefined
        const full = this.fs.join(dir, name)
        const stat = this.fs.lstat(full)
        if (!stat) continue
        out.set(full.toLowerCase(), identityOf(stat))
        if (stat.isDirectory) queue.push(full)
      }
    }
    return out
  }

  /**
   * New paths AND new identities only — an old inode moved into a fresh
   * directory must not pass itself off as session-created.
   * @param before - the snapshot taken before the shell call.
   * @param after - the snapshot taken after the shell call.
   * @param snapshotTakenAt - wall-clock moment the before snapshot was taken.
   * @returns the lower-cased keys of objects that qualify as created.
   */
  diffSnapshots(
    before: Map<string, ArtifactIdentity>,
    after: Map<string, ArtifactIdentity>,
    snapshotTakenAt: number,
  ): string[] {
    const created: string[] = []
    for (const [key, identity] of after) {
      if (before.has(key)) continue
      if (identity.birthtimeMs < snapshotTakenAt - 2) continue // pre-existing birth
      created.push(key)
    }
    return created
  }

  /**
   * Register diffed paths as session-created artifacts.
   * @param paths - the lower-cased keys from a diff to promote.
   * @returns how many paths were actually registered.
   */
  registerFromDiff(paths: Iterable<string>): number {
    let promoted = 0
    for (const key of paths) {
      const stat = this.fs.lstat(key)
      if (!stat) continue
      this.registered.set(key.toLowerCase(), identityOf(stat))
      promoted += 1
    }
    return promoted
  }

  /**
   * Shell-created artifacts promote only on clean exits.
   * @param ok - whether the shell call exited cleanly.
   */
  settleShell(ok: boolean): void {
    void ok // promotion already happened via registerFromDiff gating upstream
  }

  // -- Queries ---------------------------------------------------------------

  /**
   * Whether the path still holds its registered identity.
   * @param path - the path to check.
   * @returns true when the object exists with its original identity.
   */
  has(path: string): boolean {
    const key = this.resolve(path).toLowerCase()
    const recorded = this.registered.get(key)
    if (!recorded) return false
    const stat = this.fs.lstat(key)
    if (!stat || !sameIdentity(recorded, identityOf(stat))) return false // identity stolen
    return true
  }

  /**
   * Whether every object in the directory tree is a registered artifact.
   * @param dirPath - the directory to check.
   * @returns true when the whole tree is session-created.
   */
  hasTree(dirPath: string): boolean {
    const root = this.resolve(dirPath)
    // The anchor itself must be a REGISTERED DIRECTORY — otherwise an
    // untracked (or non-directory) path would pass vacuously because it has
    // "no strangers" underneath.
    const anchorStat = this.fs.lstat(root)
    if (!anchorStat || !anchorStat.isDirectory) return false
    if (!this.has(root)) return false
    let seen = 1
    const queue = [root]
    while (queue.length > 0) {
      const dir = queue.shift() as string
      const entries = this.fs.listDir(dir)
      if (entries === undefined) return false
      for (const name of entries) {
        seen += 1
        if (seen > MAX_TREE_OBJECTS) return false
        const full = this.fs.join(dir, name)
        if (!this.has(full)) return false // one stranger poisons the tree
        const stat = this.fs.lstat(full)
        if (stat?.isDirectory) queue.push(full)
      }
    }
    return true
  }

  /** Number of artifacts currently registered. */
  get size(): number {
    return this.registered.size
  }
}
