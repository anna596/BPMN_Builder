const express = require("express");
const cors = require("cors");
const {Pool} = require("pg");

const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Render.com PostgreSQL
  }
});

// Initialize database table on startup. Exits the process on failure 
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS diagrams (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        diagram_data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Database table initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

initializeDatabase();

app.use(cors());
app.use(express.json());

app.get("/api/diagrams", async(req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, created_at, updated_at FROM diagrams ORDER BY updated_at DESC"
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({error: error.message});
  }
});

app.get("/api/diagrams/:id", async(req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM diagrams WHERE id = $1",
      [req.params.id]
    );
    if(result.rows.length === 0){
      return res.status(404).json({error: "Diagram not found"});
    }
    res.json(result.rows[0]);
  } catch (error){
    res.status(500).json({error: error.message});
  }
});

app.post("/api/diagrams", async(req, res) => {
  const {name, diagramData} = req.body;
  if (!name || !diagramData) {
    return res.status(400).json({error: "name and diagramData are required"});
  }
  try {
    const result = await pool.query(
      "INSERT INTO diagrams (name, diagram_data) VALUES ($1, $2) RETURNING *",
      [name, diagramData]
    );
    res.status(201).json(result.rows[0]);
  } catch (error){
    res.status(500).json({error: error.message});
  }
});

app.put("/api/diagrams/:id", async(req, res) => {
  const {name, diagramData} = req.body;
  if (!name || !diagramData) {
    return res.status(400).json({error: "name and diagramData are required"});
  }
  try {
    const result = await pool.query(
      "UPDATE diagrams SET name = $1, diagram_data = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *",
      [name, diagramData, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({error: "Diagram not found"});
    }
    res.json(result.rows[0]);
  } catch (error){
    res.status(500).json({error: error.message});
  }
});

app.patch("/api/diagrams/:id", async(req, res) => {
  const {name} = req.body;
  if (!name) return res.status(400).json({error: "name is required"});
  try {
    const result = await pool.query(
      "UPDATE diagrams SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
      [name, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({error: "Diagram not found"});
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({error: error.message});
  }
});

app.delete("/api/diagrams/:id", async(req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM diagrams WHERE id = $1 RETURNING id",
      [req.params.id]
    );
    if(result.rows.length === 0){
      return res.status(404).json({error: "Diagram not found"});
    }
    res.status(204).end();
  } catch (error){
    res.status(500).json({error: error.message});
  }
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Listen on all network interfaces (allows AR headset to connect)

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`Local access: http://localhost:${PORT}`);

});

