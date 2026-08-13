## Identify which Gemini API calls in the pipeline are actually billed vs free

 > The reference notebook (Book_illustration.ipynb) states that gemini-2.5-flash-image has a free tier and doesn't require billing. When I ran it, I got a 429 quota error with limit: 0 on every image model I tried, including that one. After checking Google's current rate-limit docs and my own project's live quota page, it looks like this claim is now outdated — none of the current Gemini image-generation models have free-tier access as of this month. To make real image-generation calls at all, I need to enable billing resulting on using Gemini 3.6 Flash as the text model and Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image) as the image model. Cost: roughly 2$ for 3 separate runs.

## Deciding on how to save the data

> I proposed that since the assessment did mention the possibility of a Json file able to hold the accounts as well as the information of the work done since the test is relatively small scale, Claude did push back on the approach as doing SQLite might just be a better approach even speaking on this situation which is true. But i decided to stick with the json file as it has already fulfilled the criteria plus the advantage of it having no cost which even more allign of what im trying. Cost: Trading scaling for visibility and stability when running outside of my own device.

## Splitting `status` and `stepState`

> This is not from either side ideas since this is already an example made from the given assessment, however i do find it needed to be add since it's obviously correct for "resumable, no duplicate calls, specific in-progress state". Cost: two fields to keep consistent and a stranded [RUNNING] needs a staleness threshold to ever clear.

## Creating a mock provider

> Claude give me the idea of having to duplicate the entire process but as a mock version to see if it could work as its intended to. At first i find it unessessary as using a mock key on the main run would be sufficient but later realize such option is both money wasting and not efficient as i cannot know what happens after the style generated

## Addressing stale-step

> Claude mentioned the terms never get stuck needs to communicate well with the terms still running and proposed to set it to 90 seconds. And i agree with it since when i was using the Notebook to run the generation, an image took around a minute to fully generate. Setting this number is reasonable rather than 10-30s like the example demo. Cost : chosen for simplicity, even though it's not the most precise per-step choice

## Why Nano Banana Lite 2 Lite and not other image model

> I tried out a few models on my own API keys to see if the quality or the speed differs and while true some models process it faster than another. The quality stays pretty much the same. Cost: Speed traded for cost although the difference in speed is not too large.
> I advice you look into the video attachment to see why i reach this conclusion. (or you can follow this link to Youtube to not download anything)

## The things i would change or add if i had 1 more day (or if there were no constraint of the assessment or finance)

> I'd have used SQLite instead of Json now that the project is almost finish. while its true that reading/running a Json file is more simple and works. For the project if this were to apply on a larger scale (not to the point where Docker is needed) then comparing between those 2, SQLite is more preferable on almost all cases.

> Due to the restriction of keeping things at is, plain and simple, i find myself hard to ignore the part of the API calling for reading the book context in the given notebook. What it is doing unnecessarily is re-reading the entire book and not just only 1 chapter where it is needed. Resulting in a waste of free token used. This has been tested multiple times from my own self which could also be seen in the video attachment. Having a block of code to prevent it from re-reading the entire book would be a so much better option to do both for assessment or real life projects.

> This involves in more of a QOL feature on the web, over deliever it might or not but i find that having a button to download the image after it is generated works wonders (you could still do things like open the image in a new tab and download it but too much work when a button could have done it faster)

> Since i started out on the AI Engineer path, i found an idea of insteading of reading or typing an entire book, why not just add a feature where it just reverse it? prompts on generating the characters you want to make , the scenery and actions and ask the app to generate the story. This makes the app fully all generated and the model for doing so is quite popular as well.

> I cannot afford built-in Claude Code in VSC, yes i did use Clade to help me to code but it is from the web and the app version of it. So its not possible for me to show .claude/ file. If I did, i would have no problem sending the file

> I skipped the entire bonus section, as i have not much time to finish this even if i want to ask for 1 day extension because of IRL workload other that this. But if i were to pick a few to do, i would honestly try to deal with the Subagents, the retry storing and the more characters. While in these 3 i already done 1 of them, i decided that showing it is not worth as even if its a bonus, i feel like its just increasing a single digit.