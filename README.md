# Git-Loc
**CLI for reading your PR contribution stats across various repo's.** This tool is written as a single-entrypoint CLI, much like `git` with commands and options as the primary driver for interaction (rather than seperate scripts).

***Note:** This will ONLY track activity that you did using PRs, direct commits to `master` will not count!*

## General Usage
### CLI Flags
#### Get-Github-Data
Fetch github contribution data for user
```shell
git-stats get-github-data [ldap] [repos..]                                           [aliases: get-data, get-prs]
```
| Key | Type | Default Value | Description |
| --- | --- | --- | --- |
| `ldap` | `string` | avdaredevil | Which user to get data for |
| `repos` | `string[]` | * | The Kubeflow repos to scan in |
| `files-to-ignore` | `string[]` | * | Files or regexes (marked as `r///<regex>/`, ex. `r///\.jpg$/`) |
| `default-repo-namespace` | `string` | kubeflow | If repo is a single word, look under this Github Org / User |
| `pr-cache-freshness` | `number` | 1 | How old can the last PR be be before the cache is marked dirty, and I fetch newer PRs only (in days) |
| `expire-cache` | `boolean` | false | Expire the cache, fetch all github PR data from scratch, and re-cache |
| `input-folder` | `string` | . | Input folder to use (uses $cwd, unless overridden) |
| `casual-commit-threshold` | `number` | 500 | How much can max(loc_a, loc_d) be before it seems to be an auto-generated file? (Will generate a warning) |
| `github-api-token-file` | `string` | 1 | You need to create a github personal access token at https://github.com/settings/tokens, because github has a very strict limit on anonymous API usage. |

#### Calculate
Calculate contributions for user for a give time-range
```shell
git-stats calculate [from] [to]                                                                  [aliases: count]
```
| Key | Type | Default Value | Description |
| --- | --- | --- | --- |
| `from` | `string` | 6 months ago | `<num> <years|quarters|months|weeks|days|hours> ago` OR *A date like input (what date to look from)* |
| `to` | `string` | 0 months ago | `<num> <years|quarters|months|weeks|days|hours> ago` OR *A date like input (what date to look from)* |

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
