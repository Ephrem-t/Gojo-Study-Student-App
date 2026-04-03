import Constants from "expo-constants";

let NativePdfView = null;
let nativePdfUnavailableMessage = "";

const isExpoGo =
  Constants.executionEnvironment === "storeClient" ||
  Constants.appOwnership === "expo";

if (isExpoGo) {
  nativePdfUnavailableMessage = "The in-app PDF reader needs a development build or installed app. Expo Go cannot load the native PDF module.";
} else {
  try {
    NativePdfView = require("react-native-pdf").default;
  } catch {
    nativePdfUnavailableMessage = "The PDF reader is not available in this build. Rebuild the app and try again.";
  }
}

export { nativePdfUnavailableMessage };
export default NativePdfView;