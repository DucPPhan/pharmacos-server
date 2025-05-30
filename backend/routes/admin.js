const express = require("express");
const router = express.Router();
const Customer = require("../models/Customer");
const Order = require("../models/Order");
const Product = require("../models/Product");
const { authorize } = require("../middleware/auth");

/**
 * @swagger
 * components:
 *   schemas:
 *     CustomerList:
 *       type: object
 *       properties:
 *         customers:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/CustomerProfile'
 *         totalPages:
 *           type: integer
 *         currentPage:
 *           type: integer
 *         total:
 *           type: integer
 *     SalesAnalytics:
 *       type: object
 *       properties:
 *         salesByMonth:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               _id:
 *                 type: object
 *                 properties:
 *                   year:
 *                     type: integer
 *                   month:
 *                     type: integer
 *               totalSales:
 *                 type: number
 *               orderCount:
 *                 type: integer
 *         topSellingProducts:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               product:
 *                 $ref: '#/components/schemas/Product'
 *               totalQuantity:
 *                 type: integer
 *               totalRevenue:
 *                 type: number
 */

// Ensure all routes require admin role
router.use(authorize(["admin"]));

/**
 * @swagger
 * /api/admin/customers:
 *   get:
 *     summary: Get all customers with filtering and pagination
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name or email
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *         description: Field to sort by (e.g., name:asc, email:desc)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: List of customers
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CustomerList'
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not authorized
 */
router.get("/customers", async (req, res) => {
  try {
    const { search, sortBy, page = 1, limit = 10 } = req.query;

    let filter = {};
    if (search) {
      filter = {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      };
    }

    let sort = {};
    if (sortBy) {
      const [field, order] = sortBy.split(":");
      sort[field] = order === "desc" ? -1 : 1;
    }

    const customers = await Customer.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Customer.countDocuments(filter);

    res.json({
      customers,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/admin/customers/{id}:
 *   get:
 *     summary: Get customer details with order history
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Customer details and orders
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 customer:
 *                   $ref: '#/components/schemas/CustomerProfile'
 *                 orders:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Order'
 *       404:
 *         description: Customer not found
 */
router.get("/customers/:id", async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const orders = await Order.find({ customerId: customer._id })
      .sort({ orderDate: -1 })
      .populate("staffId", "name");

    res.json({
      customer,
      orders,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/admin/analytics/sales:
 *   get:
 *     summary: Get sales analytics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Sales analytics data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SalesAnalytics'
 */
router.get("/analytics/sales", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const matchStage = {
      status: "completed",
    };

    if (startDate && endDate) {
      matchStage.orderDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const salesAnalytics = await Order.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            year: { $year: "$orderDate" },
            month: { $month: "$orderDate" },
          },
          totalSales: { $sum: "$totalAmount" },
          orderCount: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    const topProducts = await Order.aggregate([
      { $match: matchStage },
      {
        $lookup: {
          from: "orderdetails",
          localField: "_id",
          foreignField: "orderId",
          as: "items",
        },
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.productId",
          totalQuantity: { $sum: "$items.quantity" },
          totalRevenue: {
            $sum: { $multiply: ["$items.quantity", "$items.unitPrice"] },
          },
        },
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
    ]);

    res.json({
      salesByMonth: salesAnalytics,
      topSellingProducts: topProducts,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/admin/analytics/products:
 *   get:
 *     summary: Get product performance analytics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Product performance data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 lowStockProducts:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Product'
 *                 noSalesProducts:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Product'
 *                 productSales:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                       totalSales:
 *                         type: integer
 */
router.get("/analytics/products", async (req, res) => {
  try {
    const lowStockProducts = await Product.find({
      stockQuantity: { $lt: 10 },
    }).populate("brandId", "name");

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const productSales = await Order.aggregate([
      {
        $match: {
          orderDate: { $gte: thirtyDaysAgo },
          status: "completed",
        },
      },
      {
        $lookup: {
          from: "orderdetails",
          localField: "_id",
          foreignField: "orderId",
          as: "items",
        },
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.productId",
          totalSales: { $sum: "$items.quantity" },
        },
      },
    ]);

    const soldProductIds = productSales.map((p) => p._id);
    const noSalesProducts = await Product.find({
      _id: { $nin: soldProductIds },
    }).populate("brandId", "name");

    res.json({
      lowStockProducts,
      noSalesProducts,
      productSales,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/admin/customers/{id}/status:
 *   patch:
 *     summary: Update customer status
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, blocked]
 *     responses:
 *       200:
 *         description: Customer status updated successfully
 *       404:
 *         description: Customer not found
 */
router.patch("/customers/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json(customer);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
