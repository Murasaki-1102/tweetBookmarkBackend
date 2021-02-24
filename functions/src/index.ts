import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { unset } from "lodash";
import { Tag } from "./types/tag";
//tserrorがでるため
// import Twitter from "twitter-lite";
const Twitter = require("twitter-lite");

admin.initializeApp();

const getTwitterClient = (accessToken: string, accessTokenSecret: string) => {
  return new Twitter({
    consumer_key: functions.config().twitter.apikey,
    consumer_secret: functions.config().twitter.apikeysecret,
    access_token_key: accessToken,
    access_token_secret: accessTokenSecret,
  });
};

exports.requestToken = functions
  .region("asia-northeast1")
  .https.onCall(async (data, context) => {
    console.log(context);
    const twitter = new Twitter({
      consumer_key: functions.config().twitter.apikey,
      consumer_secret: functions.config().twitter.apikeysecret,
    });
    const token = twitter
      .getRequestToken(data.callbackUrl)
      .then((res: any) => res)
      .catch(console.error);
    return { ...token };
  });

exports.onWriteTag = functions
  .region("asia-northeast1")
  .firestore.document("users/{userUid}/tags/{tagId}")
  .onWrite(async (change, context) => {
    const { userUid } = context.params;
    const db = admin.firestore();
    const batch = db.batch();
    try {
      const tagsDocRef = await db
        .collection(`users/${userUid}/tags`)
        .orderBy("index", "asc")
        .get();
      const fotmattedTags: Tag[] = tagsDocRef.docs.map((tag, index) => {
        const data = tag.data();
        return {
          id: tag.id,
          index,
          name: data.name,
          emoji: data.emoji,
          tweets: data.tweets || [],
          createdAt: data.createdAt.toDate(),
        };
      });
      await tagsDocRef.docs.map((tag) => {
        const afterIndex = fotmattedTags.find(
          (formattedTag) => formattedTag.id === tag.id
        )?.index;
        batch.update(tag.ref, { index: afterIndex });
      });
      await batch.commit();
    } catch (error) {
      console.log(error);
    }
  });

exports.getAllTweet = functions
  .region("asia-northeast1")
  .https.onCall(async (data, context) => {
    const uid = context.auth?.uid!;
    const db = admin.firestore();
    const batch = db.batch();
    const tweetRef = db.collection(`users/${uid}/tweets`);

    const client = getTwitterClient(data.accessToken, data.accessTokenSecret);

    try {
      let newTweets = await client.get("favorites/list", {
        tweet_mode: "extended",
      });

      for (let tweet of newTweets) {
        const doc = await tweetRef.doc(tweet.id_str).get();
        if (!doc.exists) {
          unset(tweet, "quoted_status.place.bounding_box.coordinates");
          unset(tweet, "place.bounding_box.coordinates");
          await batch.set(doc.ref, {
            tweet,
            tagsId: [],
            createdAt: new Date(),
          });
        }
      }
      await batch.commit();
    } catch (e) {
      if ("errors" in e) {
        // Twitter API error
        if (e.errors[0].code === 88) {
          // rate limit exceeded
          console.log(
            "Rate limit will reset on",
            new Date(e._headers.get("x-rate-limit-reset") * 1000)
          );
        } else {
          console.log(e);
        }
      } else {
        console.log(e);
      }
    }

    let allTweets: any[] = [];
    (await tweetRef.orderBy("createdAt", "desc").get()).forEach((doc) => {
      allTweets.push(doc.data().tweet);
    });

    return { allTweets };
  });
