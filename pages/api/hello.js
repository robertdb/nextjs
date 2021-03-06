const puppeteer = require('puppeteer');
require('dotenv').config();
const jsdom = require('jsdom');

const getAllAttributes = el => el
  .getAttributeNames()
  .reduce((obj, name) => ({
    ...obj,
    [name]: el.getAttribute(name)
  }), {})

const waitTillHTMLRendered = async (page, timeout = 30000) => {
  const checkDurationMsecs = 1000;
  const maxChecks = timeout / checkDurationMsecs;
  let lastHTMLSize = 0;
  let checkCounts = 1;
  let countStableSizeIterations = 0;
  const minStableSizeIterations = 3;

  while(checkCounts++ <= maxChecks){
    try {
      let html = await page.content();
      let currentHTMLSize = html.length; 
  
      let bodyHTMLSize = await page.evaluate(() => document?.body?.innerHTML.length);
  
      console.log('last: ', lastHTMLSize, ' <> curr: ', currentHTMLSize, " body html size: ", bodyHTMLSize);
  
      if(lastHTMLSize != 0 && currentHTMLSize == lastHTMLSize) 
        countStableSizeIterations++;
      else 
        countStableSizeIterations = 0; //reset the counter
  
      if(countStableSizeIterations >= minStableSizeIterations) {
        console.log("Page rendered fully..");
        break;
      }
  
      lastHTMLSize = currentHTMLSize;
      await page.waitFor(checkDurationMsecs);
    }catch (error) {
      console.log(error)
    }
  }
};

const checkDate = (dataBoxes) => {
  const wishDate = JSON.parse(process.env.WISH_GAME);

  for (let dataBox of dataBoxes) {
    const { date: { day, dayNumber, month }, available, link } = dataBox;
    if(day === wishDate.day && 
      dayNumber === wishDate.dayNumber && 
      month === wishDate.month && 
      Number(available) >= Number(wishDate.available)){
        return {
          dateIsOk: true,
          link,
        }
    }
  }

  return {  dateIsOk: false}
}

const reservationCheck = (tee) => {
  const {  time: timeTee,
    placeInfo1,
    placeInfo2,
    placeInfo3,
    placeInfo4} = tee;

    const { times, available } =  JSON.parse(process.env.WISH_GAME);
    return times.filter(({time}) => time === timeTee).length !== 0 && [ placeInfo1.available,
      placeInfo2.available,
      placeInfo3.available,
      placeInfo4.available].filter(ok => ok).length >= available
}

// constants
const LOGIN_URL = 'https://www.golfpalermo.com/?page=login&url=?page%3Dmyaccount_misreservas';
const RESERVATION_STEP_1_URL = 'https://www.golfpalermo.com/?page=reservas_step1';
const MY_RESERVATIONS_URL = 'https://www.golfpalermo.com/index.php?page=myaccount_misreservas';

const doReservation = async () => {
  console.log(JSON.parse(process.env.WISH_GAME))
  let flag = true;
  try {
    while (flag) { 
      const browser = await puppeteer.launch({headless: true}) ;
      const page = await browser.newPage();

      await page.setViewport({ width: 1200, height: 1000});
      await page.goto(LOGIN_URL);
      
      await page.focus('#usuario')
      await page.keyboard.type(process.env.USER_GOLF)

      await page.focus('#clave')
      await page.keyboard.type(process.env.PASSWORD)

      await page.click("#Ingresar");
    

      await page.goto(RESERVATION_STEP_1_URL, { timeout:0 })

      // Reserve links
      const elementHandles = await page.$$('.bigbtn');
      const propertyJsHandles = await Promise.all(
        elementHandles.map(handle => handle)
      );
      const hrefs = await Promise.all(
        propertyJsHandles.map(async handle => (await handle.getProperty('href')).jsonValue())
      );

      const elementHandlesData = await page.$$('table');
      const propertyJsHandlesData = await Promise.all(
        elementHandlesData.map(handle => handle)
      );

      // Reserve info
      const dataBox =  await Promise.all(propertyJsHandlesData.map(async (handle, index) => {
        const [day, dayNumber, month,,,,,,available ] = (await (await handle.getProperty('innerText')).jsonValue()).split("\n")
        return { 
          date: {day, dayNumber, month},
          available,
          link: hrefs[index],
        }}
      ));

      // CHECK DATE TO PLAY AND AVAILABLE PLACES
      const { dateIsOk, link } = checkDate(dataBox);
      if (!dateIsOk) {
        console.log("Not today", process.env.WISH_GAME, new Date().toLocaleString("es-AR", {timeZone: "America/Argentina/Buenos_Aires"}));
        await browser.close();
        continue;
      }

      // GO TO CHECK TEES AVAILABLE
      await page.goto(link, {'timeout': 0, 'waitUntil':'load'})
      await waitTillHTMLRendered(page)
      const data = await page.content()
      const DOM = new jsdom.JSDOM(data);
      const t = DOM.window.document.querySelector("#gridteetimes_row_0");
  

      const real = Array.from(t.rows).map((tr) => {
        const [timeStr, place1, place2, place3, place4 ] = Array.from(tr.cells);
        const time = timeStr.textContent.substring(0,5);

        const placeInfo1 = {
          "available": place1.textContent !== "Ocupado",
          attrs: place1.textContent !== "Ocupado" ? getAllAttributes(place1): {}
        }
        const placeInfo2 = {
          "available": place2.textContent !== "Ocupado",
          attrs: place2.textContent !== "Ocupado" ? getAllAttributes(place2): {}
        }
        const placeInfo3 = {
          "available": place3.textContent !== "Ocupado",
          attrs: place3.textContent !== "Ocupado" ? getAllAttributes(place3): {}
        }
        const placeInfo4 = {
          "available": place4.textContent !== "Ocupado",
          attrs: place4.textContent !== "Ocupado" ? getAllAttributes(place4): {}
        }
        return {
          time,
          placeInfo1,
          placeInfo2,
          placeInfo3,
          placeInfo4
        }  
      });

      let save = false;
      await real.forEach(async tee => {
        const {
          placeInfo1,
          placeInfo2,
          placeInfo3,
          placeInfo4} = tee;
        
          if(reservationCheck(tee) && !save){
            console.log(tee)
            if(placeInfo1.available){
              await page.click(`#${placeInfo1.attrs.id}`);
            }
            if(placeInfo2.available){
              await page.click(`#${placeInfo2.attrs.id}`);
            }
            if(placeInfo3.available){
              await page.click(`#${placeInfo3.attrs.id}`);
            }
            if(placeInfo4.available){
              await page.click(`#${placeInfo4.attrs.id}`);
            }
            save = true;
          } 
      });

      await waitTillHTMLRendered(page);
      await page.click("#BtnReservar");

      // PRINT RESERVATION IF EXIST
      await waitTillHTMLRendered(page);
      await page.goto(MY_RESERVATIONS_URL, {'timeout': 0, 'waitUntil':'load'});
      await waitTillHTMLRendered(page);
      const dataReserve = await page.content();
      const domReserve = new jsdom.JSDOM(dataReserve);
      const reservationOk = !domReserve.window.document.querySelector(".colsinreserva")?.textContent.replace(/\s/g, '').includes("Ustednoposeeningunareservavigente")
      if (reservationOk) {
        const currentDay = new Date().toLocaleString("es-AR", {timeZone: "America/Argentina/Buenos_Aires"}).replaceAll("/","-").replace(/\s/g, '');
        await page.screenshot({ 
          path: `${currentDay}.png`
        });
        flag = false;
      }
      await browser.close();
    }
  } catch (error) {
    console.error(error);
  }
}

export { doReservation };
export default function handler(req, res) {
(async () => {
  await doReservation();
})();
  res.status(200).json({ name: 'John Doe' })
}
