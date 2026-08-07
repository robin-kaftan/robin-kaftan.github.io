const specialText = document.getElementById("specialText");
const specialImg = document.getElementById("specialImg");
const dayNumber = new Date().getDay();

const dayMessages = {
    0: "Sunday: The House's Ice Cream Bowl:\nA big bowl of ice-cream!\nPerfect for almost any occasion, and overall an amazing dessert to have after a long day.",
    1: "Monday: The House's Pancake Stack\nOur biggest and grandest breakfast meal,\nperfect for starting your week with a energising bang.",
    2: "Tuesday: The House's Chocolate Shake\nA beautifully made mixture of cocoa powder, sugar and vanilla extract.\nFlavourful and simple, an amazing start or end of your day.",
    3: "Wednesday: The House's Donut Box:\nFor a celebratory halfway there, an amazing box full of sweet, sugar-coated donuts.\nPerfect food for a break in your job.",
    4: "Thursday: The House's Coffee Blend:\nA master-class grinding process makes the best coffee on the block.\nOur beans are locally sourced from farmers, ensuring you feel good with every sip.\nPhysically and physchologically.",
    5: "Friday: The House's Mixed Fruit Juice\nOur sweetest drink, for the last day of the working week.\nWe are sure you will enjoy this.",
    6: "Saturday: The House's Cocktail\nA mix of the finest alcoholic drinks and juices from some of the sweetest fruits.\nA perfect drink for a saturday-night hangout with your mates."
};

const dayImages = {
    0: "./Resources/icecream.jpg",
    1: "./Resources/Pancakes.webp",
    2: "./Resources/chocshake.jpg",
    3: "./Resources/donuts.jpg",
    4: "./Resources/coffee.jpg",
    5: "./Resources/fruitjuice.jpg",
    6: "./Resources/cocktail.jpg",
};

specialText.innerHTML = dayMessages[dayNumber];
specialImg.src = dayImages[dayNumber];