import 'promise-enhancements'
import 'colors'
import path from 'path'
import moment from 'moment'
import fetch from 'node-fetch'
import parseDiff from 'parse-diff'
import {writeFileSync, readFileSync, readFile, statSync, mkdirSync, existsSync} from 'fs'
import {sleep} from 'promise-enhancements'
import {Semaphore} from 'await-semaphore';
import {homedir} from 'os'

const FILE_SIZE_CASUAL_COMMIT_THRESHOLD = 500 // Lines
const DEFAULT_GH_TOKEN = path.resolve(homedir(), '.github_api_token')

const [ , , mode] = process.argv
const c = (s, color = 'cyan') => `${s}`[color]
const rateLimiter = new Semaphore(10) // Only allow 10 concurrent requests at any given moment

// = Config ====================|
const github_user = 'jlewi'
const repos = ['kubeflow', 'metadata', 'frontend', 'pipelines', 'testing', 'kfctl', 'manifests', 'website']
// const files2Ignore = ['package-lock.json', 'license_info.csv', 'license.txt', 'generated/src/apis', 'generated/ml_metadata/proto', '/__snapshots__/', 'dev/null', 'components/centraldashboard/app/clients', /(\.proto|\.pb\.go|swagger\.json)$/]
const files2Ignore = ['package-lock.json', 'license_info.csv', 'license.txt', 'generated/src/apis', 'sdk/python/docs/_build', 'generated/ml_metadata/proto', '/__snapshots__/', 'site-packages/', 'dev/null', 'components/centraldashboard/app/clients', /(\.(proto|pb\.go|libsonnet)|swagger\.json)$/, /^bootstrap\//,'releasing/bootstrapper/']
const P = {
    start: moment().subtract(6, 'months'),
    end: moment().subtract(0, 'months'),
}
// = Config ===============END==|

if (!/^(scan|calc|pr)$/.test(mode)) {
    console.error('Mode arg must either be scan or calc')
    process.exit()
}

const readGHToken = _ => new Promise((res, rej) => 
    readFile(DEFAULT_GH_TOKEN, (err, data) => 
        err ? rej(`Failed to read github token file: ${err.message}`) : res(data+'')
    )).then(token => {
        // To ignore line endings or whitespace
        process.GIT_TOKEN = token.replace(/\s/g, '')
    })

const fileExists = file => {
    try {statSync(file);return true} catch(e) {return false}
}

const ensureFolder = folder => {
    existsSync(folder) || mkdirSync(folder)
}
/**
 * Get URL content from git, while semaphore enabled, with waits
 * @param {string} url 
 * @param {'json' | 'text'} format 
 * @param {boolean} paginate Follow pages?
 */
async function getGit(url, format = 'json', paginate = false) {
    if (paginate) {
        let page = 0
        let entries = []
        while (1) {
            console.log(`    Reading pages: ${c(page+1)} -> ${c(page+10)}`)
            const tenPages = await Promise
                .resolve(Array(10).fill(0))
                .map((_, i) => page+i+1)
                .map(pg => getGit(`${url}&page=${pg}`))
            const isDone = tenPages.some((pg, i) => {
                if (!pg.length) return (console.log(`    Total Pages: ${c(page + i + 1)}`), 1)
                entries = entries.concat(pg)
            })
            page += 10
            if (isDone) break
        }
        return entries
    }
    const release = await rateLimiter.acquire()
    // console.log(`[Fetch] ${url}`.gray)
    const content = await Promise.retry(_ => 
        fetch(url, {headers: {Authorization: `token ${process.GIT_TOKEN}`}})
            .then(response => response[format]()),
        {times: 5, printErrors: true, errorPrefix: `    [getGit] Failed to probe: ${url}, will retry\n`},
    )
    sleep(10).then(release)
    return content
}
async function getRepoPrs(repo) {
    const jsonFile = `cache/${repo}.prs.json`
    if (fileExists(jsonFile)) {
        console.log('    Using','cached results'.green+'!')
        return JSON.parse(readFileSync(jsonFile)+'')
    }
    const pulls = await getGit(`https://api.github.com/repos/kubeflow/${repo}/pulls?state=closed&per_page=100`, 'json', true)
    writeFileSync(jsonFile, JSON.stringify(pulls))
    return pulls
}

;(async _ => {
    let weekData = {}
    await readGHToken()
    ensureFolder('./cache')

    if (mode == 'pr') {
        await Promise.resolve(repos).sync(async (repo, i) => {
            console.log(`Scanning ${github_user}@ -> ${c(repo, 'green')} (Repos Covered: ${c(i+1)})`)
            const pulls = await getRepoPrs(repo)
            try {
                const myPulls = pulls.filter(i => (i.head.user || i.user).login === github_user)
                if (!myPulls.length) return console.warn(`Bruh you have no history in kubeflow/${repo}`.brightYellow)
                console.log(`Looking at ${c(myPulls.length)}/${pulls.length} PRs`)
                await Promise.resolve(myPulls)
                    .map(pr => getGit(pr.url))
                    .map(async ({number, merged_at, created_at, patch_url, commits, additions, deletions}) => {
                        const diff = parseDiff(await getGit(patch_url, 'text'))
                        const date = merged_at || created_at
                        const w = weekData[date] = weekData[date] || {a: 0, d: 0, c: 0}
                        const ignored = {a: 0, d: 0, ent: 0}
                        const calc = {a: 0, d: 0}
                        diff.forEach(({deletions: del, additions: adds, to}) => {
                            const isIgnoreFile = files2Ignore.some(f => 
                                f instanceof RegExp ? f.test(to) : ~to.indexOf(f))
                            if (!isIgnoreFile) {
                                calc.a += adds; calc.d += del
                                if (Math.max(del, adds) > FILE_SIZE_CASUAL_COMMIT_THRESHOLD) {
                                    console.warn(`PR #${number} has a file ${to} which seems to exceed a casual file size of ${FILE_SIZE_CASUAL_COMMIT_THRESHOLD}. Make sure you didn't mean to ignore this`.brightYellow)
                                }
                                return
                            }
                            ignored.a += adds; ignored.d += del
                            ignored.ent++
                            deletions -= del
                            additions -= adds
                        })
                        deletions = Math.max(deletions, calc.d)
                        additions = Math.max(additions, calc.a)
                        console.log(
                            `    Calc PR: ${c(`#${number}`)} | +${c(additions, 'green')} -${c(deletions, 'red')} c${c(commits)}`,
                            ...(ignored.ent ? [`(Ignored ${ignored.ent} files: +${ignored.a} -${ignored.d})`] : []),
                        )
                        w.c += commits; w.a += additions; w.d += deletions
                    })
            } catch(e) {
                console.error('Something broke', e, pulls.find(i => !i.head.user || !i.user))
                process.exit(1)
            }
            writeFileSync('cache.json', JSON.stringify(weekData))
        })    
        return
    }

    if (mode == 'calc') {
        await Promise.resolve(1).then(async _ => {
            weekData = JSON.parse(readFileSync('cache.json')+'')
            let stats = {adds: 0, dels: 0, commits: 0}
            console.log(`Read ${c(Object.keys(weekData).length)} week entries...`)
            Object.entries(weekData).forEach(([w, {a, d, c}]) => {
                w = isNaN(+w) ? w : w*1000
                if (P.start.isAfter(w) || P.end.isBefore(w)) return
                stats.adds += a
                stats.dels += d
                stats.commits += c
            })

            console.log(`Stats for ${c(P.start)} -> ${c(P.end)}`)
            ;[
                `Added Lines  : ${c(stats.adds, 'green')}`,
                `Removed Lines: ${c(stats.dels, 'red')}`,
                `Commits      : ${c(stats.commits)}`,
            ].forEach(i => console.log(i))
        })
        return
    }

    await Promise.resolve(repos).sync(async (repo, i, last) => {
        console.log({repo, i, last})
        i && await sleep(1000)
        const contribs = await fetch(`https://api.github.com/repos/kubeflow/${repo}/stats/contributors`)
            .then(response => response.json())
            
        try {
            const {weeks} = contribs.find(i => i.author.login === 'avdaredevil') || {}
            if (!weeks) return console.warn(`Bruh you have no history in kubeflow/${repo}`.red)

            weeks.forEach(data => {
                const {w} = data
                weekData[w] = weekData[w] || {a: 0, d: 0, c: 0}
                'adc'.split('').forEach(key => {
                    weekData[w][key] += data[key]
                })
            });
            return weeks.length
        } catch(e) {
            console.error('Something broke', e, contribs)
            process.exit(1)
        }
    })
    writeFileSync('cache.json', JSON.stringify(weekData))
    console.log(weekData)
})()
