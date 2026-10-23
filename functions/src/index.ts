import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import * as functionsV1 from 'firebase-functions/v1';
import { COINS } from './shared/economy';

// يجب أن تطابق FUNCTIONS_REGION في src/services/firebase.ts
setGlobalOptions({ region: 'europe-west1' });

initializeApp();
const db = getFirestore();

/** رصيد ترحيبي 15 عملة عند التسجيل — يُكتب من الخادم فقط. */
// (مشغّل v1 لأنه لا يتطلب ترقية Identity Platform)
export const onSignup = functionsV1.region('europe-west1').auth.user().onCreate(async (user) => {
  await db.doc(`users/${user.uid}`).set({
    displayName: user.displayName ?? '',
    coins: COINS.signupBonus,
    createdAt: FieldValue.serverTimestamp(),
  });
});

// الخطوات القادمة (كلها onCall وتتحقق من الحركة في الخادم):
// createTable, joinTable, inviteFriend, addBot, transferOwnership,
// placeBid, declareDouble, playCard, declareProject, claimAdReward, getVivoxJoinToken, deleteAccount
