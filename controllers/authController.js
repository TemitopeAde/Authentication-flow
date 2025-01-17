const User = require("../models/User");
const { StatusCodes } = require("http-status-codes");
const CustomError = require("../errors");
const {
  attachCookiesToResponse,
  createTokenUser,
  sendResetPassswordEmail
} = require("../utils");
const crypto = require("crypto");

const { sendVerificationEmail } = require("../utils");
const Token = require("../models/Token");

const register = async (req, res) => {
  const { email, name, password } = req.body;

  const emailAlreadyExists = await User.findOne({ email });
  if (emailAlreadyExists) {
    throw new CustomError.BadRequestError("Email already exists");
  }

  // first registered user is an admin
  const isFirstAccount = (await User.countDocuments({})) === 0;
  const role = isFirstAccount ? "admin" : "user";

  const verificationToken = crypto.randomBytes(40).toString("hex");

  const origin = "http://localhost:3000";

  const user = await User.create({
    name,
    email,
    password,
    role,
    verificationToken
  });

  await sendVerificationEmail({
    name: user.name,
    email: user.email,
    verificationToken: user.verificationToken,
    origin
  });

  res.status(StatusCodes.CREATED).json({
    msg: "Sucess! Please check your email to verify account"
  });
};

const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new CustomError.BadRequestError("Please provide email and password");
  }

  const user = await User.findOne({ email });

  if (!user) {
    throw new CustomError.UnauthenticatedError("Invalid credentials");
  }

  const isPasswordCorrect = await user.comparePassword(password);

  if (!isPasswordCorrect) {
    throw new CustomError.UnauthenticatedError("Invalid credentials");
  }

  if (!user.isVerified) {
    throw new CustomError.UnauthenticatedError("Please verify your email");
  }

  const tokenUser = createTokenUser(user);

  let refreshToken = "";

  const existingToken = await Token.findOne({ user: user._id });

  if (existingToken) {
    const { isValid } = existingToken;

    if (!isValid) {
      throw new CustomError.UnauthenticatedError("Invalid credentials");
    }

    refreshToken = existingToken.refreshToken;
    attachCookiesToResponse({ res, user: tokenUser, refreshToken });
    res.status(StatusCodes.OK).json({ user: tokenUser });
    return;
  }

  refreshToken = crypto.randomBytes(40).toString("hex");
  const userAgent = req.headers["user-agent"];
  const ip = req.ip;

  const userToken = { refreshToken, ip, userAgent, user: user._id };

  await Token.create(userToken);

  attachCookiesToResponse({ res, user: tokenUser, refreshToken });

  res.status(StatusCodes.OK).json({ user: tokenUser });
};

const logout = async (req, res) => {
  const userId = req.headers.userid;
  await Token.findOneAndDelete({ _id: userId });

  res.cookie("refreshToken", "logout", {
    httpOnly: true,
    expires: new Date(Date.now())
  });

  res.status(StatusCodes.OK).json({ msg: "User logged out" });
};

const verifyEmail = async (req, res) => {
  const { verificationToken, email } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    throw new CustomError.UnauthenticatedError("Unathenticated user");
  }

  if (user.verificationToken !== verificationToken) {
    throw new CustomError.UnauthenticatedError("Invalid token");
  }

  (user.isVerified = true), (user.verified = Date.now());

  user.verificationToken = "";
  await user.save();

  res.status(StatusCodes.OK).json({
    msg: "Email verification completed"
  });
};

const forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw new CustomError.BadRequestError("Please provide valid email");
  }

  const user = await User.findOne({ email });

  if (!user) {
    throw new CustomError.BadRequestError("Please provide a valid email");
  }

  const passwordToken = crypto.randomBytes(70).toString("hex");

  const origin = "http://localhost:3000";

  await sendResetPassswordEmail({
    name: user.name,
    email: user.email,
    token: passwordToken,
    origin
  });

  const tenMinutes = 1000 * 60 * 10;
  const passwordTokenExpirationDate = new Date(Date.now() + tenMinutes);

  user.passwordToken = crypto
    .createHash("md5")
    .update(passwordToken)
    .toString();

  user.passwordTokenExpirationDate = passwordTokenExpirationDate;
  await user.save();

  res
    .status(StatusCodes.OK)
    .json({ msg: "Please check your email for reset password link" });
};

const resetPassword = async (req, res) => {
  const { token, email, password } = req.body;
  console.log(req.body);
  

  if (!token || !email || !password) {
    throw new CustomError.BadRequestError("Please provide all values");
  }
  const user = await User.findOne({ email });
  console.log(user);
  

  if (!user) {
    throw new CustomError.BadRequestError("Invalid user details");
  }

  if (
    user.passwordToken ===
      crypto.createHash("md5").update(token).toString() &&
    user.passwordTokenExpirationDate > new Date()
  ) {
    user.password = password;
    user.passwordToken = null;
    user.passwordTokenExpirationDate = null;
    await user.save();
  } else {
    throw new CustomError.BadRequestError("Incorrect password or expired token");
  }

  res.status(StatusCodes.OK).json({
    msg: "Password changed successfully"
  })
};

module.exports = {
  register,
  login,
  logout,
  verifyEmail,
  forgotPassword,
  resetPassword
};
