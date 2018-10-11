// Phantombuster configuration {
"phantombuster command: nodejs"
"phantombuster package: 5"
"phantombuster dependencies: lib-StoreUtilities.js"

const Buster = require("phantombuster")
const buster = new Buster()

const Nick = require("nickjs")
const nick = new Nick({
	loadImages: false,
	printPageErrors: false,
	printRessourceErrors: false,
	printNavigation: false,
	printAborts: false,
	debug: false,
})

const StoreUtilities = require("./lib-StoreUtilities")
const utils = new StoreUtilities(nick, buster)
const DB_NAME = "result.csv"
const DEFAULT_WAIT_TIME = 5000
const DEFAULT_PAGES_PER_LAUNCH = 2
// }

/**
 * @async
 * @description Function used to extract all URLs from buster arguments
 * @param {Array<String>} urls - Buster arguments
 * @return {Promise<Array<String>>} all URLs to scrape
 */
const inflateArguments = async urls => {
	const ret = []
	for (const url of urls) {
		try {
			const tmp = await utils.getDataFromCsv(url, null, false) // Set lib calls quiet
			utils.log(`Getting data from ${url}...`, "loading")
			utils.log(`Got ${tmp.length} lines from csv`, "done")
			ret.push(...tmp)
		} catch (err) {
			ret.push(url)
		}
	}
	return ret
}

const extractPhone = (arg, cb) => {
	const phone_REGEX = /(?:(?:\+?([1-9]|[0-9][0-9]|[0-9][0-9][0-9])\s*(?:[.-]\s*)?)?(?:\(\s*([2-9]1[02-9]|[2-9][02-8]1|[2-9][02-8][02-9])\s*\)|([0-9][1-9]|[0-9]1[02-9]|[2-9][02-8]1|[2-9][02-8][02-9]))\s*(?:[.-]\s*)?)?([2-9]1[02-9]|[2-9][02-9]1|[2-9][02-9]{2})\s*(?:[.-]\s*)?([0-9]{4})(?:\s*(?:#|x\.?|ext\.?|extension)\s*(\d+))?/gi
	let data = document.querySelector("html").innerHTML.match(phone_REGEX)
	if (Array.isArray(data)) {
		data = data.map(el => el.toLowerCase()).filter(el => !el.match(/.(png|bmp|jpeg|jpg|gif|svg)$/gi))
		data = Array.from(new Set(data)) // Make all phone unique
	} else {
		data = []
	}
	cb(null, data)
}

const scrapePhone = async (tab, url, waitTime) => {
	let result = { phones: [], url }
	try {
		const [ httpCode ] = await tab.open(url)
		if ((httpCode >= 300) || (httpCode < 200)) {
			utils.log(`${url} didn't opened properly got HTTP code ${httpCode}`, "warning")
			result.error = `${url} did'nt opened properly got HTTP code ${httpCode}`
			return result
		}
		await tab.wait(waitTime)
		let phones = await tab.evaluate(extractPhone)
		result.phones = result.phones.concat(phones)
	} catch (err) {
		utils.log(`Can't properly open ${url} due to: ${err.message || err}`, "warning")
		result.error = err.message || err
	}
	return result
}

const createCsvOutput = json => {
	const csv = []
	for (const one of json) {
		let csvElement = { url: one.url }

		if (one.error) {
			csvElement.error = one.error
		}

		if (one.phones.length < 1) {
			csvElement.phone = "no phones found"
			csv.push(csvElement)
		} else {
			for (const phone of one.phones) {
				let tmp = Object.assign({}, csvElement)
				tmp.phone = phone
				csv.push(tmp)
			}
		}
	}
	return csv
}

;(async () => {
	let { urls, timeToWait, pagesPerLaunch, queries } = utils.validateArguments()
	const tab = await nick.newTab()
	let db = await utils.getDb(DB_NAME)
	let i = 0

	let scrapingRes = []

	if (typeof urls === "string") {
		urls = [ urls ]
	}

	if (typeof queries === "string") {
		if (Array.isArray(urls)) {
			urls.push(queries)
		} else {
			urls = [ queries ]
		}
	} else if (Array.isArray(queries)) {
		(Array.isArray(urls)) ? urls.push(...queries) : urls = [ ...queries ]
	}

	if (!timeToWait) {
		timeToWait = DEFAULT_WAIT_TIME
	}

	urls = await inflateArguments(urls)

	if (!pagesPerLaunch) {
		pagesPerLaunch = DEFAULT_PAGES_PER_LAUNCH
	}

	urls = urls.filter(el => db.findIndex(line => line.url === el) < 0).slice(0, pagesPerLaunch)
	if (urls.length < 1) {
		utils.log("Input is empty OR all inputs are already scraped", "warning")
		nick.exit()
	}

	for (const url of urls) {
		utils.log(`Scraping ${url}`, "loading")
		const timeLeft = await utils.checkTimeLeft()
		if (!timeLeft.timeLeft) {
			utils.log(timeLeft.message, "warning")
			break
		}
		buster.progressHint((i + 1) / urls.length, `Scraping: ${url}`)
		const foundphones = await scrapePhone(tab, url, timeToWait)
		scrapingRes = scrapingRes.concat(foundphones)
		utils.log(`Got ${foundphones.phones.length} phone${ foundphones.phones.length === 1 ? "" : "s" } from ${url}`, "done")
		i++
	}

	db = db.concat(createCsvOutput(scrapingRes))

	await utils.saveResults(scrapingRes, db, DB_NAME.split(".").shift(), null, false)
	nick.exit(0)
})()
.catch(err => {
	utils.log(err.message || err, "error")
	nick.exit(1)
})
