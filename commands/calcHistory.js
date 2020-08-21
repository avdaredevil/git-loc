/**
 * Command implementation for Count Contributions in git-loc
 * About:
 * - Takes dynamic time input "6 <days/hours/etc> ago" or timestamp
 * - Given a range (default 6 months to now) calculate contributions
 */
import moment from 'moment'
import {join} from 'path'
import {readFileSync, statSync} from 'fs'

const CACHE_FILE = join(__dirname, '../cache', 'cache.json')
const StatObject = Object.freeze({adds: 0, dels: 0, commits: 0, prs: []})

const fileExists = file => {
    try {statSync(file);return true} catch(e) {e.code == 'ENOENT' || console.error(e);return false}
}

function processDateOrAgo(dateOrAgo) {
    const {groups} = /^(?<amount>\d+) (?<range>y|Q|M|w|d|h|(year|quarter|month|week|day|hour)s?) ago$/.exec(dateOrAgo) || {}
    if (groups) return moment().subtract(groups.amount, groups.range)
    return moment(dateOrAgo)
}

const countContrib = async _ => {
    //= ARGS ======================|
    let weekData = {}
    const fromTime = processDateOrAgo(argv.from)
    const toTime = processDateOrAgo(argv.to)

    //= Setup =====================|
    if (!fileExists(CACHE_FILE)) {
        console.error(`Missing file: ${c(CACHE_FILE)}, please run the get-prs command first!`)
        process.exit(1)
    }

    //= Work ======================|
    weekData = JSON.parse(readFileSync(CACHE_FILE))
    let [stats, rev] = [{...StatObject}, {...StatObject}]
    console.log(`Read ${c(Object.keys(weekData).length)} week entries...`)
    Object.entries(weekData).forEach(([w, {a, d, c, pr, reviewed}]) => {
        w = isNaN(+w) ? w : w*1000
        if (fromTime.isAfter(w) || toTime.isBefore(w)) return
        stats.adds += a
        stats.dels += d
        stats.commits += c
        stats.prs = stats.prs.concat(pr || [])

        const {a: ra, d: rd, c: rc, pr: rpr} = reviewed
        rev.adds += ra
        rev.dels += rd
        rev.commits += rc
        rev.prs = rev.prs.concat(rpr || [])
    })

    console.log(`Stats for ${c(fromTime)} -> ${c(toTime)}`)
    ;[
        `Added Lines   : ${c(stats.adds, 'green')}`,
        `Removed Lines : ${c(stats.dels, 'red')}`,
        `Commits       : ${c(stats.commits)}`,
        stats.prs && `PRs           : ${c(stats.prs.length)}${stats.prs.length > 0 && stats.prs.length < 5 ? ' - '+stats.prs.map(i => c(i, 'yellow')).join(', ') : ''}`,
        `  `,
        `Reviewed ${c(rev.prs.length)} PRs (${c(rev.commits)} commits) with lines: ${c(rev.adds, 'green')} added, ${c(rev.dels, 'red')} removed`,
    ].forEach(i => i && console.log(i))
}

export default countContrib
