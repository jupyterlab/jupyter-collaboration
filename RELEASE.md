# Making a jupyter-collaboration Release

## Using `jupyter_releaser`

The recommended way to make a release is to use [`jupyter_releaser`](https://github.com/jupyter-server/jupyter_releaser#checklist-for-adoption).

## Version specification

Here is an example of how version numbers progress through a release process.
Input appropriate specifier into the `jupyter-releaser` workflow dispatch dialog to bump version numbers for this release.

| Command   | Python Version Change | NPM Version change                 |
| --------- | --------------------- | ---------------------------------- |
| `major`   | x.y.z-> (x+1).0.0.a0  | All a.b.c -> a.(b+10).0-alpha.0    |
| `minor`   | x.y.z-> x.(y+1).0.a0  | All a.b.c -> a.(b+1).0-alpha.0     |
| `build`   | x.y.z.a0-> x.y.z.a1   | All a.b.c-alpha.0 -> a.b.c-alpha.1 |
| `release` | x.y.z.a1-> x.y.z.b0   | All a.b.c-alpha.1 -> a.b.c-beta.0  |
| `release` | x.y.z.b1-> x.y.z.rc0  | All a.b.c-beta.1 -> a.b.c-rc.0     |
| `release` | x.y.z.rc0-> x.y.z     | All a.b.c-rc0 -> a.b.c             |
| `patch`   | x.y.z -> x.y.(z+1)    | Changed a.b.c -> a.b.(c+1)         |
