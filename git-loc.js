import 'promise-enhancements'
import 'colors'
import yargs from 'yargs'
import path from 'path'
import {homedir} from 'os'
import {version} from './package.json'
import countContrib from './commands/calcHistory'
import getGitContribData from './commands/getGitData'

const DEFAULT_GH_TOKEN = path.resolve(homedir(), '.github_api_token')
global.c = (s, color = 'cyan') => `${s}`[color]

// = Config ====================|
global.argv = yargs
    .command(['get-github-data [ldap] [repos..]', 'get-data', 'get-prs'], 'Fetch github contribution data for user', {
        ldap: {
            description: 'Which user to get data for',
            alias: ['u', 'user'],
            type: 'string',
            default: 'avdaredevil',
        },
        repos: {
            description: 'The Kubeflow repos to scan in',
            default: ['kubeflow', 'metadata', 'frontend', 'pipelines', 'testing', 'kfctl', 'manifests', 'website', 'avdaredevil/git-loc', 'avdaredevil/promise-enhancements'],
            type: 'string[]',
            array: true,
            alias: 'r',
        },
        'files-to-ignore': {
            description: 'Files or regexes (marked as r///<regex>/, ex. r///a/)',
            default: ['package-lock.json', 'license_info.csv', 'license.txt', 'generated/src/apis', 'sdk/python/docs/_build', 'generated/ml_metadata/proto', '/__snapshots__/', 'site-packages/', 'dev/null', 'components/centraldashboard/app/clients', '/static/', 'r///(\\.(proto|pb\\.go|libsonnet|snap)|swagger\\.json)$/', 'r///^bootstrap\\//','releasing/bootstrapper/'],
            type: 'string[]',
            array: true,
            alias: ['ign', 'ignore'],
        },
        'default-repo-namespace': {
            description: 'If repo is a single word, look under this Github Org / User',
            default: 'kubeflow',
            type: 'string',
            alias: ['namespace', 'org'],
        },
        'pr-cache-freshness': {
            description: 'How old can the last PR be be before the cache is marked dirty, and I fetch newer PRs only (in days)',
            default: 1,
            type: 'number',
            alias: ['freshness'],
        },
        'expire-cache': {
            description: 'Expire the cache, fetch all github PR data from scratch, and re-cache',
            default: false,
            type: 'boolean',
        },
        verbose: {
            description: 'Increase the output verbosity of this tool. This includes throttle errors, passive debug logs, etc',
            default: false,
            type: 'boolean',
        },
        'input-folder': {
            description: 'Input folder to use (uses $cwd, unless overridden)',
            default: '.',
            type: 'string',
            alias: ['i', 'input'],
        },
        'casual-commit-threshold': {
            description: 'How much can max(loc_a, loc_d) be before it seems to be an auto-generated file? (Will generate a warning)',
            default: 500,
            type: 'number',
            alias: 'file-size-threshold',
        },
        'github-api-token-file': {
            description: `You need to create a github personal access token at https://github.com/settings/tokens`+
                `, because github has a very strict limit on anonymous API usage.`,
            default: DEFAULT_GH_TOKEN,
            type: 'string',
            alias: 'gh',
        },
    })
    .command(['calculate [from] [to]', 'count'], 'Calculate contributions for user for a give time-range', {
        from: {
            description: '<num> <years|months|weeks|days|hours> ago || A date like input (what date to look from)',
            alias: 'f',
            type: 'string',
            default: '6 months ago',
        },
        to: {
            description: '<num> <years|quarters|months|weeks|days|hours> ago || A date like input (what date to look from)',
            alias: 't',
            type: 'string',
            default: '0 months ago',
        },
    })
    .version(`v${version}`)
    .usage(`Git-Loc produces git line-of-change contributions for a user\nVersion: ${c('v'+version, 'italic')}`.brightYellow)
    .epilog('\n-- By: AP'.grey)
    .help()
    .alias('help', 'h')
    .wrap(yargs.terminalWidth())
    .demandCommand().recommendCommands().strict()
    .scriptName('git-loc').argv


// = Config ===============END==|
const runCommand = async command => {
    switch(command) {
        case 'get-prs':
        case 'get-data':
        case 'get-github-data':
            return await getGitContribData()
        case 'count':
        case 'calculate':
            return await countContrib()
    }
    throw `Unimplemented command [${command}] invoked`
}

const [command] = argv._
runCommand(command)
    .catch(e => {
        if (typeof e == 'string') {console.error(e)}
        else {console.error('Error occured:', e)}
        process.exit(1)
    })

