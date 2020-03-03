## Git-Loc
Stats for all github work done, PR based

# Git-Loc
**CLI for reading your PR contribution stats across various repo's.** This tool is written as a single-entrypoint CLI, much like `git` with commands and options as the primary driver for interaction (rather than seperate scripts).

***Note:** This will ONLY track activity that you did using PRs, direct commits to `master` will not count!*

## General Usage
## How to get all dependencies with license and source code?

### Setup
```bash
$ npm i -g git-loc
```

### Running (with installation)
```bash
$ git-loc -h   # For help
$ git-loc get-github-data [github_user] [repos]
$ git-loc calculate "1 year ago" "2 quarters ago"
```

### Running (without installation)
```bash
$ cd </path/to/git_loc (cloned)>
$ npm start -- get-github-data <args>
```
