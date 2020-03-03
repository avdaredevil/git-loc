/**
 * Command implementation for Count Contributions in git-loc
 * About:
 * - Takes a time range and calculated github work done in that range
 */
import moment from 'moment'
import {join} from 'path'
import {readFileSync, statSync} from 'fs'

const CACHE_FILE = join(__dirname, '../cache', 'cache.json')

const fileExists = file => {
    try {statSync(file);return true} catch(e) {console.error(e);return false}
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
    let stats = {adds: 0, dels: 0, commits: 0, prs: []}
    console.log(`Read ${c(Object.keys(weekData).length)} week entries...`)
    Object.entries(weekData).forEach(([w, {a, d, c, pr}]) => {
        w = isNaN(+w) ? w : w*1000
        if (fromTime.isAfter(w) || toTime.isBefore(w)) return
        stats.adds += a
        stats.dels += d
        stats.commits += c
        stats.prs = stats.prs.concat(pr || [])
    })

    console.log(`Stats for ${c(fromTime)} -> ${c(toTime)}`)
    ;[
        `Added Lines   : ${c(stats.adds, 'green')}`,
        `Removed Lines : ${c(stats.dels, 'red')}`,
        `Commits       : ${c(stats.commits)}`,
        stats.prs && `PRs           : ${c(stats.prs.length)}${stats.prs.length > 0 && stats.prs.length < 5 ? ' - '+stats.prs.map(i => c(i, 'yellow')).join(', ') : ''}`
    ].forEach(i => i && console.log(i))
}

export default countContrib
