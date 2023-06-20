/* eslint-disable no-prototype-builtins */
/* eslint-disable no-unused-vars */
/* eslint-disable max-len */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const {RtcTokenBuilder, RtcRole} = require("agora-access-token");
admin.initializeApp({
  credential: admin.credential.cert("othermind-be402-55dad2dd7888.json"),
});
const firestore = admin.firestore();
const apn = require("apn");

const firstDatabase = admin.initializeApp({
  databaseURL: "https://othermind-be402-test2.firebaseio.com",
}, "firstDatabase");


// const updateLastSeenTimestamp = (roomId) => {
//   admin.database().ref(`chats/recent_chats/${roomId}/last_seen_message`)
//       .once(
//           "value", (snap) => {
//             const activeUserData = snap.val();
//             Object.keys(snap.val()).forEach((key) => {
//               if (activeUserData[key]?.isActive) {
//                 const data = {};
//                 data[key] = {
//                   isActive: !!activeUserData[key]?.isActive,
//                   lastSeenTimestamp:
//                     activeUserData[key]?.isActive ?
//                       Date.now() :
//                       activeUserData[key].lastSeenTimestamp,
//                 };
//                 admin.database()
//                     .ref(`chats/recent_chats/${roomId}/last_seen_message`)
//                     .update(data);
//               }
//             });
//           }, (e) => {
//             functions.logger.log(e);
//           });
// };

// Firestore Method
exports.sendNotification = functions.firestore
    .document("Messages/{myId}/{targetId}/{messageId}")
    .onCreate((snapshot, context) => {
      const messageObj = snapshot.data();
      // eslint-disable-next-line max-len
      admin
          .firestore()
          .collection("Users")
          .doc(messageObj.to)
          .get()
          .then((receiverObj) => {
            const token = receiverObj.data().fcm_token;
            console.log("Token in Send Notification", token);
            if (token) {
              console.log("I am here in send notification");
              const payload = {
                // notification: {
                //   title: messageObj.senderName,
                //   body: messageObj.textMessage,
                //   sound: "default",
                // },
                data: {
                  title: messageObj.senderName,
                  body: messageObj.textMessage,
                },
              };
              return admin
                  .messaging()
                  .sendToDevice(token, payload)
                  .then((response) => {
                    return console.log("Successfully sent message:", response);
                  })
                  .catch((error) => {
                    console.log("Error sending message:", error);
                  });
            }
          });
    });

// Realtime Database Method
// eslint-disable-next-line max-len
exports.sendIOSNotification = functions.database
    .instance("othermind-be402-test2")
    .ref("ChatThreads/{chatId}/{messageId}")
    .onCreate(async (snapshot, context) => {
      const messageObj = snapshot.val();
      console.log("Message Obj", messageObj);
      const tokens = messageObj.fcm;

      /** Handling fcm token as array */
      const promises = [];

      if (tokens.length > 0) {
        tokens.forEach(async (token) => {
          if (token && messageObj.senderName !== "") {
            const payload = {
              notification: {
                title: messageObj.senderName,
                // eslint-disable-next-line max-len
                body: messageObj.file ?
                messageObj.messageType.toUpperCase() :
                messageObj.message,
                sender_ID: messageObj.from,
                fcm_token: token,
                sound: "default",
                mutable_content: "true",
              },
              data: {
                title: messageObj.senderName,
                // eslint-disable-next-line max-len
                body: messageObj.file ? messageObj.messageType : messageObj.message,
                sender_ID: messageObj.from,
                fcm_token: token,
                receiver: messageObj.to,
                messageId: messageObj.messageId,
              },
            };

            // Take more time for notification
            const user = await getUserById(messageObj.to);
            const isGroup = (messageObj.type === "group") ? true: false;

            if (!isGroup && user.deviceType === "android") {
              delete payload.notification;
            }

            // if (user.deviceType === "ios" && user.hasOwnProperty("pushKitToken")) {
            //   const payloadData ={
            //     sender: messageObj.from,
            //     receiver: messageObj.to,
            //     type: "message",
            //     messagteId: messageObj.messageId,
            //   };
            //   sendPushKitNotification(user.pushKitToken, payloadData, 0);
            // }

            const promise = admin.messaging().sendToDevice(token, payload);
            promises.push(promise);
          }
        });
      }

      // Execute all promises
      return Promise.all(promises)
          .then((responses) => {
            console.log("Successfully sent messages:", responses);
          })
          .catch((error) => {
            console.log("Error sending messages:", error);
          });
    });

exports.sendMissCall = functions.https.onRequest((request, response) => {
  const {
    caller = {},
    recipientID,
    isVideo = false,
    callUUID,
    receiverId,
  } = request.body;
  return firestore
      .collection("Users")
      .doc(receiverId)
      .get()
      .then((document) => {
        const recipient = document.data();
        updateCallStatus(
            caller,
            recipientID,
            recipient,
            isVideo,
            callUUID,
            "missed",
        ).then();
        const payload = {
          notification: {
            title: recipient.fullName,
            body: "Missed Voice Call",
            sound: "default",
          },
          data: {},
        };
        const {fcm_token: fcmToken} = recipient;
        return admin.messaging().sendToDevice(fcmToken, payload);
      })
      .catch((error) => {
        console.log("Errors", error);
      });
});
exports.sendPushCall = functions.https.onRequest((request, response) => {
  const {
    caller = {},
    recipientIDs,
    isVideo,
    callUUID,
    callStatus,
    isProduction,
  } = request.body;

  recipientIDs.forEach((recipientID) => {
    handleCall(
        caller,
        recipientID,
        isVideo,
        callUUID,
        callStatus,
        isProduction,
    ).then();
  });
});

exports.deleteUserOnDocumentDelete = functions.firestore
    .document("Users/{userId}")
    .onDelete((snap, context) => {
      const userId = context.params.userId;
      return admin.auth().deleteUser(userId)
          .then(() => {
            console.log(`Successfully deleted user with ID: ${userId}`);
            return true;
          })
          .catch((error) => {
            console.error(`Error deleting user with ID: ${userId}`, error);
            return false;
          });
    });


exports.generateCall = functions.https.onRequest(async (request, response) => {
  const {
    caller = {},
    recipientIDs,
    isVideo,
    callUUID,
    callStatus,
    isProduction,
    channel,
    uid,
    role,
    tokentype,
  } = request.body;

  const token = generateAgoraToken({channelName: channel,
    uid,
    roleType: role,
    tokentype});

  //   handleCall(
  //       caller,
  //       recipientID,
  //       isVideo,
  //       callUUID,
  //       callStatus,
  //       isProduction,
  //       token,
  //       channel,
  //   ).then();
  // });

  for (const recipientID of recipientIDs) {
    await handleCall(
        caller,
        recipientID,
        isVideo,
        callUUID,
        callStatus,
        isProduction,
        token,
        channel,
    );
  }

  return response.status(200).json({token, channel});
});


exports.updateUserStatus = functions.pubsub.schedule("every 2 minutes").onRun(async (context) => {
  const db = admin.firestore();

  const now = Date.now();
  // const snapshot = await admin.database().ref("activeUsers").once("value");
  const snapshot = await firstDatabase.database().ref("activeUsers").once("value");
  const subNode = snapshot.val();

  Object.entries(subNode).forEach(([key, value], index)=>{
    if (value.lastUpdated < now - 2 * 60 * 1000) {
      const statusRef = firstDatabase.database().ref(`User_Status/${key}`);
      const subNodePath = `activeUsers/${key}`;
      const userRef = db.collection("Users").doc(key);

      firstDatabase.database().ref(subNodePath).remove();
      statusRef.update({status: "Offline"});
      userRef.update({status: "Offline"});
    }
  });

  // eslint-disable-next-line prefer-const
  // let query = db.collection("Users");
  // query.where("lastUpdated", "<", now - 5 * 60 * 1000);
  // query.where("status", "==", "Active");

  // query.get()
  //     .then((snapshot) => {
  //       snapshot.forEach((doc) => {
  //         const docRef = db.collection("Users").doc(doc.id);
  //         docRef.update({status: "Offline"});
  //       });
  //     })
  //     .catch((error) => {
  //       console.log("ErrorMessage", error);
  //     });

  return null;
});


const getUserById = async (userId)=>{
  console.log("I am here in body of getUserBy Id");
  const doc = await firestore.collection("Users").doc(userId).get();
  return doc.data();
};


// exports.generateAgoraToken = functions.https.onRequest((req, resp) => {
//   const APP_CERTIFICATE = "1b653b913c8447d59dc4d6a2236d6c23";
//   const APP_ID = "e11719ab8eff41f9b70cf8f493b8eb71";
//   // set response header
//   resp.header("Access-Control-Allow-Origin", "*");
//   // get channel name

//   const channelName = req.query.channel;
//   if (!channelName) {
//     return resp.status(400).json({"error": "channel is required"});
//   }
//   // get uid
//   const uid = req.query.uid;
//   if (!uid || uid === "") {
//     return resp.status(400).json({"error": "uid is required"});
//   }
//   // get role
//   let role;
//   if (req.query.role === "publisher") {
//     role = RtcRole.PUBLISHER;
//   } else if (req.query.role === "audience") {
//     role = RtcRole.SUBSCRIBER;
//   } else {
//     return resp.status(400).json({"error": "role is incorrect"});
//   }
//   // get the expire time
//   let expireTime = req.query.expiry;
//   if (!expireTime || expireTime === "") {
//     expireTime = 3600;
//   } else {
//     expireTime = parseInt(expireTime, 10);
//   }
//   // calculate privilege expire time
//   const currentTime = Math.floor(Date.now() / 1000);
//   const privilegeExpireTime = currentTime + expireTime;
//   // build the token
//   let token;
//   if (req.query.tokentype === "userAccount") {
//     // eslint-disable-next-line max-len
//     token = RtcTokenBuilder.buildTokenWithAccount(APP_ID, APP_CERTIFICATE, channelName, uid, role, privilegeExpireTime);
//   } else if (req.query.tokentype === "uid") {
//     // eslint-disable-next-line max-len
//     token = RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERTIFICATE, channelName, uid, role, privilegeExpireTime);
//   } else {
//     return resp.status(400).json({"error": "token type is invalid"});
//   }
//   // return the token
//   return resp.json({"rtcToken": token});
// });


const generateAgoraToken = (paramsObj) => {
  const APP_CERTIFICATE = "1b653b913c8447d59dc4d6a2236d6c23";
  const APP_ID = "e11719ab8eff41f9b70cf8f493b8eb71";
  // set response header
  // get channel name

  const {channelName, uid, roleType, tokentype} = paramsObj;

  if (!channelName) {
    return {"error": "channel is required"};
  }

  if (!uid || uid === "") {
    return {"error": "uid is required"};
  }
  // get role
  let role;
  if (roleType === "publisher") {
    role = RtcRole.PUBLISHER;
  } else if (roleType === "audience") {
    role = RtcRole.SUBSCRIBER;
  } else {
    return {"error": "role is incorrect"};
  }
  // get the expire time
  const expireTime = 3600;
  // if (!expireTime || expireTime === "") {
  //   expireTime = 3600;
  // } else {
  //   expireTime = parseInt(expireTime, 10);
  // }
  // calculate privilege expire time
  const currentTime = Math.floor(Date.now() / 1000);
  const privilegeExpireTime = currentTime + expireTime;
  // build the token
  let token;
  if (tokentype === "userAccount") {
    // eslint-disable-next-line max-len
    token = RtcTokenBuilder.buildTokenWithAccount(APP_ID, APP_CERTIFICATE, channelName, uid, role, privilegeExpireTime);
  } else if (tokentype === "uid") {
    // eslint-disable-next-line max-len
    token = RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERTIFICATE, channelName, uid, role, privilegeExpireTime);
  } else {
    return {"error": "token type is invalid"};
  }
  // return the token
  return {"rtcToken": token};
};


const handleCall = async (
    caller,
    recipientID,
    isVideo,
    callUUID,
    callStatus,
    isProduction,
    token,
    channel,
) => {
  return firestore
      .collection("Users")
      .doc(recipientID)
      .get()
      .then((document) => {
        const recipient = document.data();
        updateCallStatus(
            caller,
            recipientID,
            recipient,
            isVideo,
            callUUID,
            "incoming",
        );
        // console.log("recipient", recipient);
        if (recipient.deviceType === "ios") {
          return constructAndSendPushKitNotification(
              caller,
              recipient,
              isVideo,
              callUUID,
              callStatus,
              isProduction,
              token,
              channel,
          );
        }
        if (recipient.deviceType === "android") {
          const payload = {
            receiverID: recipientID,
            callerID: caller.id,
            callerName: caller.fullName.toString(),
            type: isVideo.toString(),
            callUUID,
            callStatus,
            token: token.rtcToken,
            channel,
          };
          const fcmPayload = {
            notification: {},
            data: payload,
          };
          // eslint-disable-next-line max-len
          return admin.messaging().sendToDevice(recipient.fcm_token, fcmPayload);
        }
        return recipient;
      })
      .catch((error) => {
        console.log("Error", error);
      });
};

const constructAndSendPushKitNotification = async (
    caller,
    recipient,
    isVideo,
    callUUID,
    callStatus,
    isProduction,
    token,
    channel,
) => {
  let payload = {};
  switch (callStatus) {
    case "newCall":
      payload = {
        callerID: caller.id,
        callerName: caller.fullName,
        callerImage: caller.image,
        type: isVideo,
        callUUID,
        callStatus,
        token,
        channel,
      };
      break;
    case "endCall":
      payload = {
        callUUID,
        callStatus,
      };
      break;
    case "declineCall":
      payload = {
        callUUID,
        callStatus,
      };
      break;
    case "acceptCall":
      payload = {
        callUUID,
        callStatus,
      };
      break;
    default:
      return "";
  }
  return sendPushKitNotification(recipient.pushKitToken, payload, isProduction);
};

const updateCallStatus = async (
    caller,
    recipientID,
    receiverName,
    isVideo,
    callUUID,
    status,
) => {
  const docRef = firestore
      .collection("Calls")
      .doc(`${recipientID}`)
      .collection("CallHistory")
      .doc(`${callUUID}`);
  await docRef.set({
    callerID: caller.id,
    callerName: caller.fullName,
    callerImage: caller.image,
    callStatus: status,
    isVideo,
    receiverID: recipientID,
    receiverName: receiverName.fullName,
    receiverImage: receiverName.profile_image,
    callUUID,
    createdAt: Date.now(),
  });
};

const sendPushKitNotification = async (token, payload, isProduction) => {
  console.log("isProduction", isProduction == 0 ? false : true);
  const config = {
    production: isProduction == 0 ? false : true,
    cert: "OtherMindVoipServices.pem",
    key: "OtherMindVoipServices.pem",
    passphrase: "123123" /* replace this with your own password */,
  };

  const apnProvider = new apn.Provider(config);
  const notification = new apn.Notification();

  const recipients = [];
  recipients.push(apn.token(token));

  // you have to add the suffix
  // .voip here!! Make sure it matches your Bundle ID
  notification.topic = "org.name.othermind.voip";
  notification.payload = payload;

  return apnProvider.send(notification, recipients).then((response) => {
    console.log("Send Notification", response);
  });
};


