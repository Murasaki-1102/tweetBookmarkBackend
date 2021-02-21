import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { unset } from "lodash";
import { Tag } from "./types/tag";
const Twitter = require("twitter-lite");

admin.initializeApp();

exports.requestToken = functions
  .region("asia-northeast1")
  .https.onCall(async (data, context) => {
    const twitter = new Twitter({
      consumer_key: functions.config().twitter.apikey,
      consumer_secret: functions.config().twitter.apikeysecret,
    });
    const token = await twitter.getRequestToken(data.callbackUrl);
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

exports.onSetAllTweet = functions
  .region("asia-northeast1")
  .https.onCall(async (data, context) => {
    const uid = context.auth?.uid!;
    const db = admin.firestore();
    const batch = db.batch();
    const tweetRef = db.collection(`users/${uid}/tweets`);
    const allTweet = data.tweets.map((tweet: any) =>
      unset(tweet, "quoted_status.place.bounding_box.coordinates")
    );
    await allTweet.map(async (tweet: any) => {
      batch.set(tweetRef.doc(tweet.id_str), {
        tweet,
        tagsId: [],
        createdAt: new Date(),
      });
    });
    await batch.commit();
  });
