const puppeteer = require('puppeteer');
const mongodb = require('mongodb');

async function main() {
    const browser = await puppeteer.launch({
        // headless: false, // launch headful mode
        // slowMo: 250,
        // devtools: true // slow down puppeteer script so that it's easier to follow visually
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(0);
    page.on('console', msg => {
        console.log(msg.text());
    });

    await page.goto('https://www.bricklink.com/browse.asp');
    console.log("1/3 loading countries ..");
    let countries = await page.evaluate(() => {
        // getting first 4 containers - countries grouped by 4 regions
        let regions = Array.from(document.getElementsByClassName('store-list')).slice(0,4);
        let countries = [];
        regions.forEach(element => {
            Array.from(element.getElementsByTagName("a")).forEach(link => {
                const countryData = {
                    'name': link.innerText,
                    'link': link.href
                }
                countries.push(countryData);
            });
        });
        return countries;
    });

    console.log("2/3 loading shops ..");
    let shops = [];
    for (let country of countries) {
        await page.goto(country.link,  { waitUntil: "load" });
        shops = shops.concat(await page.evaluate(country => {
            let data = [];
            const table = document.getElementsByClassName("fv").item(0);
            Array.from(table.getElementsByTagName("a")).forEach((link) => {
                const shopData = {
                    'country': country.name,
                    'name': link.innerText,
                    'link': link.href
                }
                if(shopData.name === '') return;
                data.push(shopData);
            });
            return data;
        },country));
    };

    console.log("3/3 getting items ..");
    mongodb.MongoClient.connect('mongodb://localhost:27017/',(err,db) => {
        const mongoDb = db.db("brick_db");
        getShops(shops,page,mongoDb);
    });
}

function getItems(items,shop,document){
    Array.from(document.getElementsByTagName("article")).forEach(article => {
        const description = article.getElementsByClassName("description").item(0);
        const name = description.getElementsByTagName("p").item(0).innerText;
        const caption = description.getElementsByClassName("caption").item(0).innerText;
        const condition = article.getElementsByClassName("condition").item(0).innerText;
        let path = "";
        Array.from(description.getElementsByClassName("bl-breadcrumb").item(0).children).forEach((segment) => {
            path+=segment.innerText + " ";
        });
        const buy = article.getElementsByClassName("buy").item(0);
        const quantity = Array.from(buy.getElementsByTagName("strong"))[0].innerText;
        let price = buy.getElementsByTagName("div").item(0).getElementsByTagName("p").item(0);
        if(price) {
            price = price.innerText;
        }
        else {
            price = buy.getElementsByTagName("div").item(0).getElementsByTagName("strong").item(0).innerText;
        }
        price = price.replace(/[~$()EURUS]/g,"");
        items.push({
            "name":name,
            "condition":condition.replace("\n"," "),
            "quantity":quantity,
            "caption":caption,
            "price":""+Math.floor(parseFloat(price.replace(",","")) * 100) / 100,
            "path":path, 
            "date": new Date().toUTCString(),
            "country": shop.country,
            "shop": shop.name
        });
    });
    return items;
}

async function getShops(shops,page,mongoDb) {
    for (let shop of shops) {
        const start = new Date();
        await page.goto(shop.link+'#/shop?o={"pgSize":100,"showHomeItems":0}',  { waitUntil: "networkidle0" });
        const pageCount = await page.evaluate(() => {
            if(!document.getElementsByClassName("pagination").item(0)) {
                return 0;
            }
            const paginationNavbar =  document.getElementsByClassName("pagination").item(0).children;
            const pageCount = paginationNavbar[paginationNavbar.length - 2].getElementsByTagName("a").item(0).innerText;
            return pageCount;
        });

        await page.addScriptTag({ content: `${getItems}`});
        let items = await page.evaluate(async (shop) => {
            return getItems([],shop,document);
        },shop);

        if(pageCount > 1) {
            for (let pageIdx = 2; pageCount >= pageIdx; pageIdx++) {
                await page.goto(shop.link+'#/shop?o={"pgSize":100,"pg":'+pageIdx+',"showHomeItems":0}',  { waitUntil: "networkidle0" });
                await page.addScriptTag({ content: `${getItems}`});
                items = (await page.evaluate((shop,items) => {
                    return getItems(items,shop,document);
                },shop,items));
            }
        }
        if(items && items.length > 0)
        await mongoDb.collection("brick_data").insertMany(items, function(err, res) {
            if (err) throw err;
            console.log("-------------");
            console.log("shop: ",shop.name);
            console.log("Number of documents inserted: " + res.insertedCount);
            console.log("Pages visited: " + pageCount);
            console.log("Time elapsed (in seconds): ", Math.round((new Date() - start)/1000))
        });
    }
    getShops(shops,page,mongoDb);
}

main();



// FOR TESTING - read shops from file
// var fs = require('fs');
// let shops = [];
// fs.readFile('shops.json', 'utf8',(err, fileContent) => {
//     if( err ) {
//         return [];
//     } else {
//     console.log("test");
//     shops = JSON.parse(fileContent.toString());
//     mongodb.MongoClient.connect('mongodb://localhost:27017/',(err,db) => {
//         const mongoDb = db.db("brick_db");
//         getShops(shops,page,mongoDb);
//     });   

//     }
// });