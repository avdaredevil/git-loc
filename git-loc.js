import 'promise-enhancements'
import 'colors'
import yargs from 'yargs'
import path from 'path'
import {homedir} from 'os'
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
            type: 'string',
            alias: ['i', 'input'],
        },
        'files-to-ignore': {
            description: 'Files or regexes (marked as r///<regex>/, ex. r///a/)',
            default: ['package-lock.json', 'license_info.csv', 'license.txt', 'generated/src/apis', 'sdk/python/docs/_build', 'generated/ml_metadata/proto', '/__snapshots__/', 'site-packages/', 'dev/null', 'components/centraldashboard/app/clients', 'r///(\\.(proto|pb\\.go|libsonnet)|swagger\\.json)$/', 'r///^bootstrap\\//','releasing/bootstrapper/'],
            type: 'string',
            alias: ['i', 'input'],
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
    .help()
    .alias('help', 'h')
    .wrap(yargs.terminalWidth())
    .demandCommand().recommendCommands().strict()
    .scriptName('git-stats').argv


// = Config ===============END==|

const runCommand = async command => {
    switch(command) {
        case 'get-github-data': return await getGitContribData()
        case 'calculate': return await countContrib()
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

