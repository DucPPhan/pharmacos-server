const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    function: {
      type: String,
      required: true,
      enum: ["lotion", "wash", "cream", "serum", "mask", "other"],
    },
    skinGroup: {
      type: String,
      required: true,
      enum: ["oily", "dry", "combination", "sensitive", "normal"],
    },
    ageGroup: String,
    genderTarget: {
      type: String,
      enum: ["male", "female", "unisex"],
    },
    brandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    imageUrl: String,
    stockQuantity: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    aiFeatures: {
      type: Map,
      of: String,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for similar products
productSchema.virtual("similarProducts", {
  ref: "ProductSimilarity",
  localField: "_id",
  foreignField: "productId",
});

module.exports = mongoose.model("Product", productSchema);
