export type BlogArticle = {
  slug: string;
  title: string;
  seoTitle: string;
  description: string;
  category: string;
  publishedAt: string;
  readingMinutes: number;
  intro: string[];
  sections: {
    heading: string;
    paragraphs?: string[];
    bullets?: string[];
    steps?: string[];
  }[];
};

export const blogArticles: BlogArticle[] = [
  {
    slug: "how-to-find-correct-wiper-blade-size",
    title: "How to Find the Right Wiper Blade Size for Your Car",
    seoTitle: "How to Find the Right Wiper Blade Size for Your Car",
    description:
      "Learn how to find the correct driver and passenger wiper blade sizes, check the fitting type and avoid common fitment mistakes.",
    category: "Wiper Guides",
    publishedAt: "2026-07-11",
    readingMinutes: 7,
    intro: [
      "Replacing windscreen wipers should be a straightforward job, but choosing the correct blades is not always as simple as buying the same size for both sides.",
      "Many vehicles use one length on the driver side and another on the passenger side. The blade also needs to match the vehicle's wiper arm, which means that length is only one part of the fitment.",
      "Before ordering new wiper blades, it is worth checking a few basic details."
    ],
    sections: [
      {
        heading: "Start With Your Vehicle Details",
        paragraphs: [
          "The easiest place to begin is with the vehicle's make, model, year, and body style or model generation where relevant.",
          "Vehicle manufacturers may update the wiper system during a model change or facelift. Two vehicles with similar names can sometimes use different blade lengths or attachment systems.",
          "When using a vehicle finder, select the closest matching model and year rather than relying only on the vehicle name."
        ]
      },
      {
        heading: "Driver and Passenger Wiper Blades Are Often Different Sizes",
        paragraphs: [
          "Many vehicles use a longer blade on the driver side because it needs to clear a larger area of the windscreen.",
          "The passenger-side blade is often shorter so that both blades can move through their full range without contacting each other or extending beyond the edge of the glass."
        ],
        bullets: [
          "24-inch driver blade and 18-inch passenger blade",
          "26-inch driver blade and 16-inch passenger blade",
          "Two blades of the same length"
        ]
      },
      {
        heading: "Check the Existing Wiper Blades",
        paragraphs: [
          "If the current blades fit correctly, they can provide a useful reference. Some wiper blades have the length printed or moulded into the blade body.",
          "You can also remove the blade and measure it from end to end. A small difference between your measurement and a standard replacement size is normal, especially when comparing inch and millimetre measurements.",
          "However, measuring the existing blade should not be the only check. A previous owner may have installed an incorrect size."
        ],
        bullets: ["18 inches", "20 inches", "22 inches", "450 mm", "500 mm", "550 mm"]
      },
      {
        heading: "Length Is Only One Part of the Fitment",
        paragraphs: [
          "Two wiper blades with the same length will not necessarily fit the same vehicle. The blade must also connect correctly to the wiper arm.",
          "A multi-fit wiper blade may include several adapters to suit different arm types, but the correct adapter still needs to be selected and installed properly.",
          "Do not force an adapter into place. A correctly matched fitting should attach securely without requiring excessive pressure."
        ],
        bullets: ["Push button", "Side pin", "Bayonet", "Pinch tab", "Top lock"]
      },
      {
        heading: "Why the Correct Blade Length Matters",
        paragraphs: [
          "A blade that is too long may contact the edge of the windscreen, touch the other wiper blade, put unnecessary load on the wiper mechanism, or lift away from the glass near the outer edge.",
          "A blade that is too short may leave part of the intended viewing area unwiped. Using the recommended blade combination generally provides the best coverage and movement."
        ]
      },
      {
        heading: "Check the New and Old Blades Before Installation",
        paragraphs: [
          "Before removing all packaging, place the new blade beside the existing blade and compare the overall length, connection point, wiper arm fitting, and adapter orientation.",
          "The blade body may have a different shape, especially when replacing a conventional frame-style blade with a beam-style design. This does not necessarily mean the blade is incorrect."
        ]
      },
      {
        heading: "Take Care When Lifting the Wiper Arm",
        paragraphs: [
          "Wiper arms are spring-loaded. When replacing a blade, lift the arm carefully and avoid allowing the bare metal arm to snap back onto the windscreen.",
          "Placing a folded towel on the glass can provide some protection while the blade is removed. After fitting the new blade, gently lower the arm and check that the blade sits evenly against the windscreen."
        ]
      },
      {
        heading: "Test the Blades After Installation",
        steps: [
          "Check that each adapter is fully locked.",
          "Make sure the blade can move freely on the arm.",
          "Use the washer system to wet the windscreen.",
          "Run the wipers through several complete cycles.",
          "Check for contact between the blades or with the edge of the glass."
        ]
      },
      {
        heading: "What If You Are Still Unsure?",
        paragraphs: [
          "If the vehicle is listed in the NexAutoParts vehicle finder, select the make, model and year to view the recommended blade combination.",
          "Choosing the correct wiper blade involves checking the vehicle, blade length and adapter type together. Taking a few minutes to confirm all three can make installation much easier and help avoid unnecessary returns."
        ]
      }
    ]
  },
  {
    slug: "how-often-replace-wiper-blades-nz",
    title: "How Often Should You Replace Your Wiper Blades in New Zealand?",
    seoTitle: "How Often Should You Replace Wiper Blades in NZ?",
    description:
      "Learn how often to inspect and replace your wiper blades, plus the common signs of worn or damaged windscreen wipers.",
    category: "Wiper Care",
    publishedAt: "2026-07-11",
    readingMinutes: 6,
    intro: [
      "Wiper blades are easy to overlook. Most drivers do not think about replacing them until heavy rain arrives and the windscreen suddenly becomes difficult to see through.",
      "In many cases, the blades have been losing performance gradually for several months. A small streak may appear first. Later, the blade may begin to miss part of the glass, make noise or leave a thin film of water behind.",
      "So, how often should wiper blades be replaced, and what signs should you look for?"
    ],
    sections: [
      {
        heading: "There Is No Exact Replacement Date",
        paragraphs: [
          "Wiper blades are often checked every six months and may need replacement around once a year. However, this should be treated as a general guide rather than a fixed schedule.",
          "The actual lifespan depends on how often the vehicle is driven, whether it is parked indoors or outdoors, exposure to sunlight, road dust, wiper use, and the condition of the windscreen.",
          "Instead of replacing blades only according to age, pay attention to how they perform."
        ]
      },
      {
        heading: "Common Signs That Wiper Blades Are Wearing Out",
        paragraphs: [
          "A worn blade may leave narrow lines of water behind during each pass. If the same streaks continue to appear in the same areas after cleaning, the rubber may be worn or damaged.",
          "A healthy blade should maintain reasonably even contact with the glass. If the middle or outer section is no longer wiping properly, the blade may have lost flexibility or may not be following the curve of the windscreen.",
          "Wiper noise can have several causes, including dirt, a dry windscreen, contaminated rubber, or a blade that is not securely attached."
        ],
        bullets: ["Streaks remain on the windscreen", "Part of the windscreen is being missed", "The blades squeak or chatter", "The rubber is cracked or lifting", "Visibility becomes worse at night"]
      },
      {
        heading: "Does New Zealand Weather Affect Wiper Blade Life?",
        paragraphs: [
          "Wiper blades are exposed to changing conditions throughout the year. Sunlight and heat can gradually harden the rubber, particularly when a vehicle is parked outside for long periods.",
          "During colder or wetter months, the blades may be used more frequently and collect more dirt from the road. Vehicles near the coast may also be exposed to salt, moisture and windblown residue.",
          "There is no single replacement schedule that suits every part of New Zealand, but checking the blades before winter or before a long road trip is a practical habit."
        ]
      },
      {
        heading: "Can Cleaning Improve Wiper Performance?",
        paragraphs: [
          "Sometimes. Dirt often collects along the narrow rubber edge that touches the windscreen. Removing this contamination may improve wiping performance when the blade itself is still in good condition.",
          "Cleaning can remove dirt, but it cannot repair rubber that has hardened, split or permanently lost its shape."
        ],
        steps: [
          "Clean the windscreen using a suitable automotive glass cleaner.",
          "Lift the wiper arm carefully.",
          "Wipe the rubber edge with a clean, damp microfibre cloth.",
          "Inspect the rubber for cracks or damage.",
          "Lower the arm gently back onto the windscreen."
        ]
      },
      {
        heading: "Should Both Front Wiper Blades Be Replaced Together?",
        paragraphs: [
          "In many cases, replacing the front pair together is sensible. Both blades are usually exposed to similar sunlight, weather and operating conditions.",
          "Replacing the pair can also provide more consistent wiping across the windscreen. The driver and passenger blades are often different lengths, so check the correct size combination before ordering."
        ]
      },
      {
        heading: "Do Not Forget the Rear Wiper",
        paragraphs: [
          "Rear wipers are used less frequently on many vehicles and can be overlooked for several years. Inspect the rear blade for the same problems, including streaking, cracked rubber, missed sections, noise, or vibration.",
          "Because rear windows often collect dust and road grime, make sure the glass is wet before testing the blade."
        ]
      },
      {
        heading: "Check Before the Next Heavy Rain",
        paragraphs: [
          "You do not need to wait until the wipers stop working properly. Use the washer system and watch a complete wiping cycle.",
          "There is no exact replacement interval that applies to every vehicle. The condition and performance of the blade are usually more useful than its age alone."
        ]
      }
    ]
  },
  {
    slug: "wiper-blades-squeaking-leaving-streaks",
    title: "Why Are My Windscreen Wipers Squeaking or Leaving Streaks?",
    seoTitle: "Why Are My Wipers Squeaking or Leaving Streaks?",
    description:
      "Find out why windscreen wipers squeak, chatter or leave streaks, and learn when cleaning, adjustment or replacement may help.",
    category: "Troubleshooting",
    publishedAt: "2026-07-11",
    readingMinutes: 7,
    intro: [
      "Noisy or streaky windscreen wipers are frustrating, especially when visibility is already reduced by rain.",
      "It is easy to assume that the blades need to be replaced immediately, but the problem is not always caused by worn rubber. Dirt on the windscreen, contamination along the blade edge or insufficient washer fluid can produce similar symptoms.",
      "Before replacing the blades, it helps to identify what is happening and when the problem occurs."
    ],
    sections: [
      {
        heading: "Why Do Wiper Blades Leave Streaks?",
        paragraphs: [
          "Streaks usually appear when the rubber edge is unable to clear water evenly from the glass. The location of the streak can provide a useful clue.",
          "A narrow line that appears in the same place during every wipe may be caused by a small damaged section of rubber. A cloudy film across a larger area may be related to residue on the glass."
        ],
        bullets: ["Dirt on the windscreen", "Road grime or residue", "Contamination on the blade edge", "Worn or damaged rubber", "Uneven contact with the glass", "An incorrectly fitted blade"]
      },
      {
        heading: "Clean the Windscreen First",
        paragraphs: [
          "Before inspecting the blades, clean the windscreen thoroughly. Normal car washing may not remove all oily residue, traffic film or product buildup from the glass.",
          "Use a suitable automotive glass cleaner and a clean microfibre cloth. Pay attention to the area where the wipers rest, as dirt can collect near the lower edge of the windscreen.",
          "After cleaning, test the wipers using washer fluid rather than operating them on dry glass."
        ]
      },
      {
        heading: "Clean the Rubber Wiping Edge",
        paragraphs: [
          "The blade itself can collect dust, pollen, road grime and other residue. Lift the wiper arm carefully and wipe the rubber edge with a damp microfibre cloth.",
          "While doing this, inspect the rubber for cracks, splits, rough areas, loose sections, and uneven wear. Do not pull heavily on the rubber, as this may damage the blade."
        ]
      },
      {
        heading: "Why Do Windscreen Wipers Squeak?",
        paragraphs: [
          "Squeaking often occurs when the rubber does not move smoothly across the glass. Wipers are designed to move across a wet surface, so operating them on a dry windscreen can create friction and noise.",
          "Contamination on either the glass or blade can prevent smooth movement. Some windscreen products may also leave a coating that changes how the rubber moves across the surface.",
          "Over time, exposure to sunlight and weather can reduce the flexibility of the wiping edge."
        ]
      },
      {
        heading: "What Causes Wiper Chatter or Jumping?",
        paragraphs: [
          "Chatter occurs when the blade repeatedly grips and releases the glass instead of moving smoothly. The movement may look like a small vibration or a series of jumps across the windscreen.",
          "Start with cleaning and check that the blade is securely fitted. If the problem began immediately after installing new blades, compare the blade length and adapter with the vehicle's required fitment."
        ],
        bullets: ["A dirty or dry windscreen", "Hardened blade rubber", "Incorrect blade installation", "An adapter that is not fully locked", "Uneven pressure across the blade", "A blade that does not match the vehicle"]
      },
      {
        heading: "Check the Blade Size and Adapter",
        paragraphs: [
          "A replacement blade should match both the required length and the wiper arm fitting. A blade that is too long may contact the windscreen edge or interfere with the other blade.",
          "The adapter should also sit securely on the wiper arm. After installation, gently check that the blade is locked into position."
        ]
      },
      {
        heading: "When Is Cleaning Enough?",
        paragraphs: [
          "Cleaning may be enough when the rubber is still flexible, there are no visible cracks or splits, the blade sits evenly against the glass, and the problem improves after cleaning.",
          "If the problem returns quickly, the blade may be approaching the end of its useful life."
        ]
      },
      {
        heading: "When Should the Blade Be Replaced?",
        paragraphs: [
          "Replacement may be the better option when streaks remain after the glass and blade have been cleaned, the rubber is cracked, large areas are being missed, or visibility remains poor in rain.",
          "Wiper blades wear gradually, so the difference may not be obvious until a new set is fitted."
        ]
      },
      {
        heading: "Final Check After Fitting New Blades",
        steps: [
          "Make sure each adapter is fully secured.",
          "Check that the blades do not contact each other.",
          "Wet the windscreen using washer fluid.",
          "Run several complete wiping cycles.",
          "Look for streaks, vibration or missed areas."
        ],
        paragraphs: [
          "A clean windscreen, suitable blade size and secure fitting are all important parts of achieving a smooth and consistent wipe."
        ]
      }
    ]
  }
];

export function getBlogArticle(slug: string) {
  return blogArticles.find((article) => article.slug === slug) ?? null;
}

export function getRelatedBlogArticles(slug: string) {
  return blogArticles.filter((article) => article.slug !== slug).slice(0, 2);
}
