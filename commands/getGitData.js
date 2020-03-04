/**
 * Command implementation for Get Github Data in git-loc
 * About:
 * - Use Github Auth to access your data with extended API Quotas
 * - Process:
 *   - Fetch all PRs per repo (including retry and pagination) - 10 pages async
 *   - Differential Caching for Repo Data (cache + fetch (2 pg / async) for new PRs)
 *   - Fetch PR Data, per PR, and the Diff Data
 *   - Scan diff data and count only contributions to files that pass the ignore check (auto-gen files are skipped)
 *   - Create a Hashmap<week, {a, d, commit, prs}>
 *   - Write Contribution Data to ../cache/cache.json
 */
import fetch from 'node-fetch'
import parseDiff from 'parse-diff'
import moment from 'moment'
import {join} from 'path'
import {Semaphore} from 'await-semaphore'
import {sleep} from 'promise-enhancements'
import {writeFileSync, readFileSync, readFile, statSync, mkdirSync, existsSync} from 'fs'

const CACHE_FOLDER = join(__dirname, '../cache')
const CACHE_FILE = join(CACHE_FOLDER, 'cache.json')
const rateLimiter = new Semaphore(10) // Only allow 10 concurrent requests at any given moment

const readGHToken = _ => new Promise((res, rej) => 
    readFile(argv['github-api-token-file'], (err, data) => 
        err ? rej(`Failed to read github token file: ${err.message}`) : res(data+'')
    )).then(token => {
        // To ignore line endings or whitespace
        process.GIT_TOKEN = token.replace(/\s/g, '')
    })

const fileExists = file => {
    try {statSync(file);return true} catch(e) {return false}
}

const ensureFolder = folder => existsSync(folder) || mkdirSync(folder)

/**
 * Get URL content from git, while semaphore enabled, with waits
 * @param {string} url
 * @param {{format: 'json' | 'text', paginate: false, readBy: 10, stopCondition: (object) => array} | ('json' | 'text')} options format
 * @param {false} paginate Follow pages?
 * @param {number} readBy Read in increments of how many pages?
 * @param {(object) => array} stopCondition Function that will be run against a page, and should an object that will then be used as the new content for that page, and stop looping
 */
async function fetchGitUrl(url, options) {
    let {
        format = 'json',
        paginate = false,
        readBy = 10,
        stopCondition = _ => false,
    } = typeof options == 'string' ? {format: options} : options || {};
    if (paginate) {
        let page = 0
        let entries = []
        while (1) {
            console.log(`    Reading pages: ${c(page+1)} -> ${c(page+readBy)}`)
            const tenPages = await Promise
                .resolve(Array(readBy).fill(0))
                .map((_, i) => page+i+1)
                .map(pg => fetchGitUrl(`${url}&page=${pg}`))
            const isDone = tenPages.some((pg, i) => {
                if (!pg.length) return (console.log(`    Total Pages: ${c(page + i + 1)}`), 1)
                const newPg = stopCondition(pg)
                if (newPg) {
                    entries = entries.concat(newPg)
                    console.log(`    Stop Condition triggered, Total Pages: ${c(page + i + 1)}`)
                    return 1
                }
                entries = entries.concat(pg)
            })
            page += readBy
            if (isDone) break
        }
        return entries
    }
    const release = await rateLimiter.acquire()
    const content = await Promise.retry(_ => 
        fetch(url, {headers: {Authorization: `token ${process.GIT_TOKEN}`}})
            .then(response => response[format]()),
        {times: 5, printErrors: true, errorPrefix: `    [getGit] Failed to probe: ${url}, will retry\n`},
    )
    sleep(10).then(release)
    return content
}
function repoName(repo) {return ~repo.indexOf('/') ? repo : `kubeflow/${repo}`}
async function getRepoPrs(repo) {
    const repoSafe = repo.replace(/\\|\//g,'-')
    const jsonFile = join(CACHE_FOLDER, `${repoSafe}.prs.json`)
    let cacheData = []
    if (!argv['expire-cache'] && fileExists(jsonFile)) {
        console.log('    Loading','cached results'.green+'!')
        cacheData = JSON.parse(readFileSync(jsonFile)+'')
        if (cacheData.length && moment().add(argv.freshness, 'days').isBefore(cacheData[0].created_at)) {
            return cacheData
        }
        console.log(`    Cache is ${!cacheData.length ? 'empty, fetching data' : 'old enough, fetching incremental updates'}...`)
    }

    const gitRepo = repoName(repo)
    const pulls = await fetchGitUrl(`https://api.github.com/repos/${gitRepo}/pulls?state=closed&per_page=100`,
        {format: 'json', paginate: true, readBy: cacheData.length ? 2 : 10, stopCondition: page => {
            if (!cacheData.length) return
            const idx = page.findIndex(ent => ent.number == cacheData[0].number)
            if (!~idx) return
            return page.slice(0, idx)
        }},
    )
    const finalData = pulls.concat(cacheData)
    writeFileSync(jsonFile, JSON.stringify(finalData))
    return finalData
}

const getGitContribData = async _ => {
    //= ARGS ======================|
    let weekData = {}
    const {user: github_user, repos} = argv
    const FILE_SIZE_CASUAL_COMMIT_THRESHOLD = argv['casual-commit-threshold']
    
    const files2Ignore = argv['files-to-ignore'].map(i => {
        if (!/^r\/\//.test(i)) return i
        const [fl, ...expr] = i.slice(4).split('/').reverse()
        return new RegExp(expr.reverse().join('/'), fl)
    })
    
    //= Validation =====================|
    let fails = repos.some(i => /^[\w\-]+\/[\w\-]+$/)
    if (fails.length) {
        console.error('These repos are formatted incorrectly, they can either be like "repoA" or "user/repoB":\n', repos.map(i => c(i, 'yellow')).join(', '))
        process.exit(1)
    }
    
    //= Setup =====================|
    await readGHToken()
    ensureFolder(CACHE_FOLDER)
    
    //= Work ======================|
    await Promise.resolve(repos).sync(async (repo, i) => {
        console.log(`Scanning ${github_user}@ -> ${c(repo, 'green')} (Repos Covered: ${c(i+1)})`)
        const pulls = await getRepoPrs(repo)
        try {
            const myPulls = pulls.filter(i => i.user.login === github_user || i.head.user === github_user)
            if (!myPulls.length) return console.warn(`    Bruh you have no history in ${repoName(repo)}`.brightYellow)
            console.log(`    Looking at ${c(myPulls.length)}/${pulls.length} PRs`)
            await Promise.resolve(myPulls)
                .map(pr => fetchGitUrl(pr.url))
                .map(async ({number, merged_at, created_at, patch_url, commits, additions, deletions}) => {
                    const diff = parseDiff(await fetchGitUrl(patch_url,
                        {format: 'text'},
                    ))
                    const date = merged_at || created_at
                    const w = weekData[date] = weekData[date] || {a: 0, d: 0, c: 0, pr: []}
                    const ignored = {a: 0, d: 0, ent: 0}
                    const calc = {a: 0, d: 0}
                    diff.forEach(({deletions: del, additions: adds, to}) => {
                        const isIgnoreFile = files2Ignore.some(f => 
                            f instanceof RegExp ? f.test(to) : ~to.indexOf(f))
                        if (!isIgnoreFile) {
                            calc.a += adds; calc.d += del
                            if (Math.max(del, adds) > FILE_SIZE_CASUAL_COMMIT_THRESHOLD) {
                                console.warn(`        PR #${number} has a file ${to} which seems to exceed a casual file size of ${FILE_SIZE_CASUAL_COMMIT_THRESHOLD}. Make sure you didn't mean to ignore this`.brightYellow)
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
                        `        Calc PR: ${c(`#${number}`)} | +${c(additions, 'green')} -${c(deletions, 'red')} c${c(commits)}`,
                        ...(ignored.ent ? [`(Ignored ${ignored.ent} files: +${ignored.a} -${ignored.d})`] : []),
                    )
                    w.c += commits; w.a += additions; w.d += deletions
                    w.pr.push(`${repo}#${number}`)
                })
        } catch(e) {
            console.error('Something broke', e, pulls.find(i => !i.head.user || !i.user))
            process.exit(1)
        }
        writeFileSync(CACHE_FILE, JSON.stringify(weekData))
    })    
}

export default getGitContribData

/**
 * OLD Implementation:
 * await Promise.resolve(repos).sync(async (repo, i, last) => {
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
 */