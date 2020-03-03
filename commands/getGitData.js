/**
 * Command implementation for Get Github Data in git-loc
 * About:
 * - TBD
 */
import fetch from 'node-fetch'
import parseDiff from 'parse-diff'
import {join} from 'path'
import {Semaphore} from 'await-semaphore'
import {sleep} from 'promise-enhancements'
import {writeFileSync, readFileSync, readFile, statSync, mkdirSync, existsSync} from 'fs'

const CACHE_FOLDER = join(__dirname, '../cache')
const CACHE_FILE = join(CACHE_FOLDER, 'cache.json')
const rateLimiter = new Semaphore(10) // Only allow 10 concurrent requests at any given moment

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

const ensureFolder = folder => existsSync(folder) || mkdirSync(folder)

/**
 * Get URL content from git, while semaphore enabled, with waits
 * @param {string} url 
 * @param {'json' | 'text'} format 
 * @param {boolean} paginate Follow pages?
 * @param {(object): boolean} stopCondition Function that will be run against a page, and should return true if further scanning should be stopped?
 */
async function fetchGitUrl(url, {
    format = 'json',
    paginate = false,
    stopCondition = _ => false,
}) {
    if (paginate) {
        let page = 0
        let entries = []
        while (1) {
            console.log(`    Reading pages: ${c(page+1)} -> ${c(page+10)}`)
            const tenPages = await Promise
                .resolve(Array(10).fill(0))
                .map((_, i) => page+i+1)
                .map(pg => fetchGitUrl(`${url}&page=${pg}`))
            const isDone = tenPages.some((pg, i) => {
                if (!pg.length || stopCondition(pg)) return (console.log(`    Total Pages: ${c(page + i + 1)}`), 1)
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
    const jsonFile = join(CACHE_FOLDER, `${repo}.prs.json`)
    if (fileExists(jsonFile)) {
        console.log('    Using','cached results'.green+'!')
        return JSON.parse(readFileSync(jsonFile)+'')
    }
    const pulls = await fetchGitUrl(`https://api.github.com/repos/kubeflow/${repo}/pulls?state=closed&per_page=100`, 'json', true)
    writeFileSync(jsonFile, JSON.stringify(pulls))
    return pulls
}

const getGitContribData = async _ => {
    //= ARGS ======================|
    let weekData = {}
    const {user: github_user, repos} = yargs
    const FILE_SIZE_CASUAL_COMMIT_THRESHOLD = yargs['casual-commit-threshold']
    
    const files2Ignore = yargs['files-to-ignore'].map(i => {
        if (!/^r\/\//.test(i)) return i
        const [fl, expr] = i.slice(4).reverse().split('/')
        return new RegExp(expr.reverse.join('/'), fl)
    })
    
    //= Setup =====================|
    await readGHToken()
    ensureFolder(CACHE_FOLDER)
    
    //= Work ======================|
    await Promise.resolve(repos).sync(async (repo, i) => {
        console.log(`Scanning ${github_user}@ -> ${c(repo, 'green')} (Repos Covered: ${c(i+1)})`)
        const pulls = await getRepoPrs(repo)
        try {
            const myPulls = pulls.filter(i => i.user.login === github_user || i.head.user === github_user)
            if (!myPulls.length) return console.warn(`Bruh you have no history in kubeflow/${repo}`.brightYellow)
            console.log(`Looking at ${c(myPulls.length)}/${pulls.length} PRs`)
            await Promise.resolve(myPulls)
                .map(pr => fetchGitUrl(pr.url))
                .map(async ({number, merged_at, created_at, patch_url, commits, additions, deletions}) => {
                    const diff = parseDiff(await fetchGitUrl(patch_url, 'text'))
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