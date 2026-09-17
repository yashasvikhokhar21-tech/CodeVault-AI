const mongoose = require("mongoose");
const { Schema } = mongoose;

const PullRequestSchema = new Schema(
  {
    repository: { type: Schema.Types.ObjectId, ref: "Repository", required: true, index: true },
    number: { type: Number, required: true },
    title: { type: String, required: true, maxlength: 200 },
    description: { type: String, default: "", maxlength: 5000 },
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sourceBranch: { type: String, required: true },
    targetBranch: { type: String, required: true },
    status: { type: String, enum: ["OPEN", "MERGED", "CLOSED"], default: "OPEN" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    mergedAt: { type: Date },
    mergedBy: { type: Schema.Types.ObjectId, ref: "User" },
    mergeCommit: { type: String },
    comments: [{
      author: { type: Schema.Types.ObjectId, ref: "User", required: true },
      text: { type: String, required: true, maxlength: 5000 },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
    }],
  },
  { timestamps: false }
);

PullRequestSchema.index({ repository: 1, number: 1 }, { unique: true });

module.exports = mongoose.model("PullRequest", PullRequestSchema);
